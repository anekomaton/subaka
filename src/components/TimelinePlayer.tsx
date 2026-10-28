/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward, Music, Volume2, Volume1, VolumeX, Film, ChevronDown, ChevronUp, Square, CheckCircle2, Type, Maximize2, Minimize2, Loader2, Download, RefreshCw, Subtitles, X, FileText, Languages, User, Plus } from 'lucide-react';
import { SubtitleEntry, PlaybackState } from '../types';
import { srtTimeToSeconds, secondsToSrtTime, sanitizeSrtHtml, parseSrt } from '../utils/subtitleUtils';
import { extractAudioFromMkv, probeMkvAudioCodec, AudioTrackInfo } from '../utils/mkvAudioExtractor';
import { extractAudioWithFFmpeg, terminateFFmpegWorker } from '../utils/ffmpegExtractor';
import { extractSrtSubtitles, probeSubtitles, SubtitleTrackInfo, isSupportedSubtitleCodec, downloadRawSubtitleTrack } from '../utils/srtSubtitleExtractor';
import { saveFileUniversal, isTauriDesktop, restorePostFullscreenBoundsDesktop } from '../utils/tauriBridge';

interface TimelinePlayerProps {
  subtitles: SubtitleEntry[];
  playbackState: PlaybackState;
  onPlaybackStateChange: (updated: Partial<PlaybackState>) => void;
  activeSubtitleIndex: number;
  onSelectSubtitle: (index: number) => void;
  mediaLoadingProgress: number | null;
  setMediaLoadingProgress: (p: number | null) => void;
  mediaFileName: string;
  setMediaFileName: (name: string) => void;
  mediaFile: File | null;
  setMediaFile: (file: File | null) => void;
  addToast?: (message: string, type?: 'success' | 'info' | 'error') => void;
  latestMessage?: { message: string; type: 'success' | 'info' | 'error' } | null;
  messagesHistory?: { id: string; timestamp: string; message: string; type: 'success' | 'info' | 'error' }[];
  onClearHistory?: () => void;
  isTranscribing: boolean;
  onTranscribe: () => Promise<void>;
  onCancelTranscribe?: () => void;
  hasAutoSubtitles?: boolean;
  onApplyAutoSubtitles?: () => void;
  extAudioFile?: File | null;
  onExtAudioFileChange?: (file: File | null) => void;
  theme?: 'dark' | 'light';
  autoTranslate?: boolean;
  onSubtitlesLoaded?: (entries: SubtitleEntry[], autoTranslateSelected?: boolean) => void;
  onTranslationSubtitlesLoaded?: (entries: SubtitleEntry[]) => void;
  processedTracks?: Record<number, { blob: Blob; audioFile: File; label: string }>;
  onProcessedTracksChange?: React.Dispatch<React.SetStateAction<Record<number, { blob: Blob; audioFile: File; label: string }>>>;
  activeTrackNumber?: number | null;
  onActiveTrackNumberChange?: (num: number | null) => void;
  activeExternalTrackId?: string | null;
  onActiveExternalTrackIdChange?: (id: string | null) => void;
  onAudioProcessingChange?: (isProcessing: boolean) => void;
  showActorsOnPlayer?: boolean;
  onToggleShowActorsOnPlayer?: (enabled: boolean) => void;
  onRegisterAddExternalAudio?: (fn: (file: File) => Promise<void>) => void;
  onAddSubtitle?: (customTime?: number) => void;
}

function TimelinePlayerComponent({
  subtitles,
  playbackState,
  onPlaybackStateChange,
  activeSubtitleIndex,
  onSelectSubtitle,
  mediaLoadingProgress,
  setMediaLoadingProgress,
  mediaFileName,
  setMediaFileName,
  mediaFile,
  setMediaFile,
  addToast,
  latestMessage = null,
  messagesHistory = [],
  onClearHistory,
  isTranscribing,
  onTranscribe,
  onCancelTranscribe,
  hasAutoSubtitles = false,
  onApplyAutoSubtitles,
  extAudioFile = null,
  onExtAudioFileChange,
  theme = 'dark',
  autoTranslate = false,
  onSubtitlesLoaded,
  onTranslationSubtitlesLoaded,
  processedTracks: propProcessedTracks,
  onProcessedTracksChange: propSetProcessedTracks,
  activeTrackNumber: propActiveTrackNumber,
  onActiveTrackNumberChange: propSetActiveTrackNumber,
  activeExternalTrackId: propActiveExternalTrackId,
  onActiveExternalTrackIdChange: propSetActiveExternalTrackId,
  onAudioProcessingChange,
  showActorsOnPlayer = true,
  onToggleShowActorsOnPlayer,
  onRegisterAddExternalAudio,
  onAddSubtitle,
}: TimelinePlayerProps) {
  const [mediaUrl, setMediaUrl] = useState<string>('');
  const [mediaType, setMediaType] = useState<'video' | 'audio' | 'none'>('none');
  const [duration, setDuration] = useState<number>(30); // Default simulated duration of 30s
  const [extAudioUrl, setExtAudioUrl] = useState<string>('');
  const [extAudioFileName, setExtAudioFileName] = useState<string>('');
  const [, setRequiresTranscode] = useState<boolean>(false);
  const [audioProcessingStatus, setAudioProcessingStatus] = useState<{
    isProcessing: boolean;
    message: string;
    progress: number | null;
  }>({
    isProcessing: false,
    message: '',
    progress: null,
  });

  useEffect(() => {
    onAudioProcessingChange?.(audioProcessingStatus.isProcessing);
  }, [audioProcessingStatus.isProcessing, onAudioProcessingChange]);
  const extAudioRef = useRef<HTMLAudioElement>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);

  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [showAudioTrackSelectModal, setShowAudioTrackSelectModal] = useState<boolean>(false);
  const [selectedTrackKey, setSelectedTrackKey] = useState<string>('');
  const [uploadedAudioTracks, setUploadedAudioTracks] = useState<{
    id: string;
    file: File;
    originalName: string;
    label: string;
  }[]>([]);

  const [internalActiveExternalTrackId, setInternalActiveExternalTrackId] = useState<string | null>(null);
  const activeExternalTrackId = propActiveExternalTrackId !== undefined ? propActiveExternalTrackId : internalActiveExternalTrackId;
  const setActiveExternalTrackId = (id: string | null) => {
    setInternalActiveExternalTrackId(id);
    propSetActiveExternalTrackId?.(id);
  };

  const [internalProcessedTracks, setInternalProcessedTracks] = useState<
    Record<number, { blob: Blob; audioFile: File; label: string }>
  >({});
  const processedTracks = propProcessedTracks !== undefined ? propProcessedTracks : internalProcessedTracks;
  const setProcessedTracks: React.Dispatch<React.SetStateAction<Record<number, { blob: Blob; audioFile: File; label: string }>>> = (action) => {
    if (propSetProcessedTracks) {
      propSetProcessedTracks(action);
    } else {
      setInternalProcessedTracks(action);
    }
  };

  const [internalActiveTrackNumber, setInternalActiveTrackNumber] = useState<number | null>(null);
  const activeTrackNumber = propActiveTrackNumber !== undefined ? propActiveTrackNumber : internalActiveTrackNumber;
  const setActiveTrackNumber = (num: number | null) => {
    setInternalActiveTrackNumber(num);
    propSetActiveTrackNumber?.(num);
  };

  const activeTrackNumberRef = useRef<number | null>(activeTrackNumber);

  const setActiveTrackNumberAndRef = (num: number | null) => {
    activeTrackNumberRef.current = num;
    setActiveTrackNumber(num);
  };

  const embeddedTracks = availableAudioTracks.length > 0 ? availableAudioTracks : (
    mediaFile ? [{ trackNumber: 1, codecName: 'Асноўнае аўдыя', isDefault: true }] : []
  );

  const modalTrackList = [
    ...embeddedTracks.map(tr => {
      let rawCodec = tr.codecName || tr.codecId || '';
      if (rawCodec.startsWith('A_')) {
        rawCodec = rawCodec.substring(2);
      }

      let channelsText = '';
      if (tr.channels) {
        if (tr.channels === 1) channelsText = '1 кн. (Mono)';
        else if (tr.channels === 2) channelsText = '2 кн. (Stereo)';
        else if (tr.channels === 3) channelsText = '3 кн. (2.1 / 3.0)';
        else if (tr.channels === 4) channelsText = '4 кн. (4.0 Quad)';
        else if (tr.channels === 5) channelsText = '5 кн. (5.0 Surround)';
        else if (tr.channels === 6) channelsText = '6 кн. (5.1 Surround)';
        else if (tr.channels === 7) channelsText = '7 кн. (6.1 Surround)';
        else if (tr.channels === 8) channelsText = '8 кн. (7.1 Surround)';
        else channelsText = `${tr.channels} кн.`;
      }

      return {
        key: `embedded_${tr.trackNumber}`,
        type: 'embedded' as const,
        trackNumber: tr.trackNumber,
        nameTag: tr.trackName || `Дарожка #${tr.trackNumber}`,
        langTag: tr.language ? `[${tr.language.toUpperCase()}]` : '',
        codecTag: rawCodec,
        channelsTag: channelsText,
        isDefault: tr.isDefault,
        isProcessed: !!processedTracks[tr.trackNumber],
        isActive: activeExternalTrackId === null && (activeTrackNumber === tr.trackNumber || (activeTrackNumber === null && tr.trackNumber === 1)),
        isUnsupportedCodec: tr.isUnsupportedCodec,
        rawEmbeddedTrack: tr,
        extTrack: null,
      };
    }),
    ...uploadedAudioTracks.map(extTr => ({
      key: extTr.id,
      type: 'external' as const,
      trackNumber: 0,
      nameTag: extTr.originalName,
      langTag: '',
      codecTag: 'Знешні аўдыяфайл',
      channelsTag: '',
      isDefault: false,
      isProcessed: true,
      isActive: activeExternalTrackId === extTr.id,
      isUnsupportedCodec: false,
      rawEmbeddedTrack: null,
      extTrack: extTr,
    }))
  ];

  const [hasEmbeddedSubtitles, setHasEmbeddedSubtitles] = useState<boolean>(false);
  const [availableSubTracks, setAvailableSubTracks] = useState<SubtitleTrackInfo[]>([]);
  const [showTrackSelectModal, setShowTrackSelectModal] = useState<boolean>(false);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState<number>(0);
  const [isExtractingSrt, setIsExtractingSrt] = useState<boolean>(false);
  const [srtProcessingProgress, setSrtProcessingProgress] = useState<string>('');
  const [srtProcessingPercent, setSrtProcessingPercent] = useState<number>(0);

  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  // Close speed menu on outside click or Escape
  useEffect(() => {
    if (!showSpeedMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSpeedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [showSpeedMenu]);

  // Close track selection modals on Escape key
  useEffect(() => {
    if (!showTrackSelectModal && !showAudioTrackSelectModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowTrackSelectModal(false);
        setShowAudioTrackSelectModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showTrackSelectModal, showAudioTrackSelectModal]);

  useEffect(() => {
    if (!mediaFile) {
      setHasEmbeddedSubtitles(false);
      setAvailableSubTracks([]);
      return;
    }

    probeSubtitles(mediaFile).then((probe) => {
      if (probe.hasSubtitles && probe.tracks && probe.tracks.length > 0) {
        setHasEmbeddedSubtitles(true);
        setAvailableSubTracks(probe.tracks);
        if (probe.tracks.length > 1) {
          addToast?.(`Выяўлена субцітраў: ${probe.tracks.length}. Даступны выбар пры выцягванні.`, 'info');
        } else {
          addToast?.(`Выяўлены ўбудаваныя субцітры ў файле (${probe.codecId || 'SRT'}). Даступна выцягванне па кнопцы.`, 'info');
        }
      } else {
        setHasEmbeddedSubtitles(false);
        setAvailableSubTracks([]);
      }
    }).catch(() => {
      setHasEmbeddedSubtitles(false);
      setAvailableSubTracks([]);
    });
  }, [mediaFile]);

  const executeExtraction = async (targetTrackNumber?: number, targetTrackIndex?: number, isTranslation?: boolean) => {
    if (!mediaFile) return;

    setIsExtractingSrt(true);
    setSrtProcessingPercent(0);
    setSrtProcessingProgress('аналіз...');
    addToast?.('Пачалася працэдура выцягвання субцітраў...', 'info');

    try {
      const result = await extractSrtSubtitles(mediaFile, targetTrackNumber, targetTrackIndex, (pct, msg) => {
        setSrtProcessingPercent(pct);
        setSrtProcessingProgress(msg || `${pct}%`);
      });

      if (result && result.srtContent && result.srtContent.trim().length > 0) {
        const entries = parseSrt(result.srtContent);
        if (entries.length > 0) {
          if (isTranslation) {
            if (onTranslationSubtitlesLoaded) {
              onTranslationSubtitlesLoaded(entries);
            } else if (onSubtitlesLoaded) {
              onSubtitlesLoaded(entries, autoTranslate);
            }
            addToast?.(`Субцітры паспяхова выцягнуты як пераклад! (картак: ${entries.length})`, 'success');
          } else {
            if (onSubtitlesLoaded) {
              onSubtitlesLoaded(entries, autoTranslate);
            }
            addToast?.(`Субцітры паспяхова выцягнуты і дададзены ў працоўную вобласць! (картак: ${entries.length})`, 'success');
          }

          // Only seek to startSec if there is no active media file and playback is not running
          if (
            mediaType === 'none' &&
            !playbackState.isPlaying &&
            (!playbackState.currentTime || playbackState.currentTime === 0) &&
            entries[0] &&
            entries[0].startTime
          ) {
            const startSec = srtTimeToSeconds(entries[0].startTime);
            onPlaybackStateChange({ currentTime: startSec });
          }
        } else {
          addToast?.('Не ўдалося распазнаць карткі субцітраў з атрыманага тэксту.', 'info');
        }
      } else {
        addToast?.('У гэтым файле не знойдзена сумяшчальних убудаваных субцітраў', 'info');
      }
    } catch (err) {
      console.error('Error extracting SRT subtitles:', err);
      addToast?.('Не ўдалося выцягнуць субцітры з файла.', 'error');
    } finally {
      setIsExtractingSrt(false);
      setSrtProcessingProgress('');
      setSrtProcessingPercent(0);
    }
  };

  const [downloadingSubIdx, setDownloadingSubIdx] = useState<number | null>(null);

  const handleDownloadRawSubTrack = async (track: SubtitleTrackInfo, trackIdx: number) => {
    if (!mediaFile) return;
    try {
      setDownloadingSubIdx(trackIdx);
      addToast?.(`Пачалася падрыхтоўка дарожкі субцітраў для спампоўвання...`, 'info');
      const success = await downloadRawSubtitleTrack(mediaFile, trackIdx, track, (pct, msg) => {
        if (pct === 100) {
          addToast?.('Дарожка субцітраў паспяхова спампавана!', 'success');
        }
      });
      if (!success) {
        addToast?.('Не ўдалося спампаваць дарожку субцітраў з файла.', 'error');
      }
    } catch (err) {
      console.error('Download raw sub track failed:', err);
      addToast?.('Памылка пры спампоўванні дарожкі субцітраў', 'error');
    } finally {
      setDownloadingSubIdx(null);
    }
  };

  const handleExtractAndImportSrt = async () => {
    if (!mediaFile) {
      addToast?.('Спачатку загрузіце медыяфайл.', 'info');
      return;
    }

    const probe = await probeSubtitles(mediaFile);
    if (!probe.hasSubtitles || !probe.tracks || probe.tracks.length === 0) {
      addToast?.('У зыходным файле не выяўлена ўбудаваных субцітраў.', 'info');
      setHasEmbeddedSubtitles(false);
      return;
    }

    setAvailableSubTracks(probe.tracks);
    setSelectedTrackIdx(0);
    setShowTrackSelectModal(true);
  };

  const cancelAudioProcessing = () => {
    if (audioAbortControllerRef.current) {
      audioAbortControllerRef.current.abort();
      audioAbortControllerRef.current = null;
    }
    terminateFFmpegWorker();
    setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
    onExtAudioFileChange?.(null);
    addToast?.('Апрацоўка аўдыя спынена', 'info');
  };

  const executeAudioExtraction = async (targetTrackNumber?: number, fileOverride?: File, forceExtraction: boolean = false) => {
    const targetFile = fileOverride || mediaFile;
    if (!targetFile) return;

    const trackNumKey = targetTrackNumber || 1;

    // 0. Ensure we have probed track info
    let trackInfo = availableAudioTracks.find(t => t.trackNumber === trackNumKey);
    if (!trackInfo && availableAudioTracks.length === 0) {
      try {
        const probe = await probeMkvAudioCodec(targetFile);
        if (probe.tracks && probe.tracks.length > 0) {
          setAvailableAudioTracks(probe.tracks);
          trackInfo = probe.tracks.find(t => t.trackNumber === trackNumKey) || probe.tracks[0];
        }
      } catch {}
    }

    // 1. Check if target track is already processed and cached in processedTracks
    if (processedTracks[trackNumKey]) {
      const cached = processedTracks[trackNumKey];
      setActiveTrackNumberAndRef(trackNumKey);
      setExtAudioFileName(`${targetFile.name} [Аўдыя: ${cached.label}]`);
      onExtAudioFileChange?.(cached.audioFile);
      if (extAudioUrl) URL.revokeObjectURL(extAudioUrl);
      setExtAudioUrl(URL.createObjectURL(cached.audioFile));
      const isUnsupported = availableAudioTracks.find(t => t.trackNumber === trackNumKey)?.isUnsupportedCodec ?? false;
      setRequiresTranscode(isUnsupported);
      addToast?.(`Пераключана на раней апрацаваную дарожку #${trackNumKey} (${cached.label})`, 'success');
      return;
    }

    const hasNativeAudioTrackSwitching = !!(videoRef.current && (videoRef.current as any).audioTracks && (videoRef.current as any).audioTracks.length > 0);
    const isSupportedCodec = trackInfo ? !trackInfo.isUnsupportedCodec : true;

    // Native playback without extraction is ONLY possible if:
    // 1) The track is a supported browser codec (!trackInfo.isUnsupportedCodec), AND
    // 2) EITHER the browser supports HTMLMediaElement.audioTracks native switching,
    //    OR this is track #1 (which <video> naturally plays by default).
    // In Chromium / WebView2 (Tauri Desktop), audioTracks is not available.
    // Therefore track #2+ CANNOT play natively and must be extracted into extAudioUrl.
    const canPlayNatively = !forceExtraction && isSupportedCodec && (
      hasNativeAudioTrackSwitching || trackNumKey === 1
    );

    if (canPlayNatively) {
      setActiveTrackNumberAndRef(trackNumKey);
      if (extAudioUrl) {
        URL.revokeObjectURL(extAudioUrl);
        setExtAudioUrl('');
      }
      setExtAudioFileName('');
      onExtAudioFileChange?.(null);
      setRequiresTranscode(false);

      if (hasNativeAudioTrackSwitching) {
        const tracks = (videoRef.current as any).audioTracks;
        if (tracks && tracks.length > 0) {
          for (let i = 0; i < tracks.length; i++) {
            tracks[i].enabled = (i === (trackNumKey - 1) || tracks[i].id === String(trackNumKey));
          }
        }
      }

      const codecLabel = trackInfo?.codecName || 'AAC';
      addToast?.(`Пераключана на дарожку #${trackNumKey} (${codecLabel}). Гук прайграецца натыўна.`, 'success');
      return;
    }

    // 2. Check if this track is currently processing
    if (audioProcessingStatus.isProcessing && activeTrackNumberRef.current === trackNumKey) {
      setActiveTrackNumberAndRef(trackNumKey);
      const isUnsupported = availableAudioTracks.find(t => t.trackNumber === trackNumKey)?.isUnsupportedCodec ?? false;
      setRequiresTranscode(isUnsupported);
      addToast?.(`Дарожка #${trackNumKey} ужо апрацоўваецца...`, 'info');
      return;
    }

    // 3. Abort previous background extraction if a different track was processing
    if (audioAbortControllerRef.current) {
      audioAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    audioAbortControllerRef.current = controller;

    setActiveTrackNumberAndRef(trackNumKey);

    trackInfo = trackInfo || availableAudioTracks.find(t => t.trackNumber === trackNumKey);
    const requiresTranscodeNeeded = trackInfo?.isUnsupportedCodec ?? !isSupportedCodec;
    setRequiresTranscode(requiresTranscodeNeeded);

    setAudioProcessingStatus({
      isProcessing: true,
      message: !requiresTranscodeNeeded ? 'выцягванне аўдыя 5%' : 'транскод аўдыя 5%',
      progress: 5,
    });

    const trackNameTag = trackInfo?.trackName || (trackNumKey ? `Дарожка #${trackNumKey}` : '');
    const trackCodecTag = trackInfo?.codecName || '';
    const displayTag = trackNameTag || trackCodecTag;

    if (!requiresTranscodeNeeded) {
      addToast?.(`Выцягванне аўдыядарожкі ${displayTag ? `(${displayTag})` : ''} (без транскадавання)...`, 'info');
    } else {
      addToast?.(`Запуск транскоду аўдыядарожкі ${displayTag ? `(${displayTag})` : ''}...`, 'info');
    }

    try {
      let result = await extractAudioFromMkv(
        targetFile,
        trackNumKey,
        (p, msg) => {
          if (controller.signal.aborted) return;
          setAudioProcessingStatus({
            isProcessing: true,
            message: msg || (p !== null && p >= 0 ? `апрацоўка аўдыя ${p}%` : 'апрацоўка аўдыя...'),
            progress: p
          });
        },
        controller.signal
      );

      if (controller.signal.aborted) {
        if (audioAbortControllerRef.current === controller) {
          setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
        }
        return;
      }

      let blobToUse = result?.blob;
      let codecTagToUse = displayTag || result?.codecId || 'AAC';

      // Fallback to extractAudioWithFFmpeg if direct demux failed
      if (!blobToUse) {
        setAudioProcessingStatus({
          isProcessing: true,
          message: 'апрацоўка аўдыя 10%',
          progress: 10,
        });
        const ffResult = await extractAudioWithFFmpeg(
          targetFile,
          (p, msg) => {
            if (controller.signal.aborted) return;
            setAudioProcessingStatus({
              isProcessing: true,
              message: msg || (p !== null && p >= 0 ? `апрацоўка аўдыя ${p}%` : 'апрацоўка аўдыя...'),
              progress: p
            });
          },
          controller.signal
        );

        if (controller.signal.aborted) {
          if (audioAbortControllerRef.current === controller) {
            setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
          }
          return;
        }
        if (ffResult && ffResult.blob) {
          blobToUse = ffResult.blob;
          codecTagToUse = displayTag || 'FFmpeg Audio';
        }
      }

      if (blobToUse) {
        let mimeTypeToUse = result?.mimeType || blobToUse.type || 'audio/aac';
        if (mimeTypeToUse === 'audio/mp4') mimeTypeToUse = 'audio/aac';
        let extToUse = '.aac';
        if (mimeTypeToUse.includes('mp3') || mimeTypeToUse.includes('mpeg')) extToUse = '.mp3';
        else if (mimeTypeToUse.includes('wav')) extToUse = '.wav';
        else if (mimeTypeToUse.includes('ogg')) extToUse = '.ogg';
        else if (mimeTypeToUse.includes('flac')) extToUse = '.flac';
        else if (mimeTypeToUse.includes('aac') || mimeTypeToUse.includes('mp4') || mimeTypeToUse.includes('m4a')) extToUse = '.aac';

        const cleanAudioName = targetFile.name.replace(/\.[^/.]+$/, '') + `_audio${trackNumKey}${extToUse}`;
        const audioFile = new File([blobToUse], cleanAudioName, { type: mimeTypeToUse });

        setProcessedTracks(prev => ({
          ...prev,
          [trackNumKey]: { blob: blobToUse!, audioFile, label: codecTagToUse }
        }));

        setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
        addToast?.(`Аўдыя: Паспяхова апрацавана дарожка #${trackNumKey} (${codecTagToUse}).`, 'success');

        if (activeTrackNumberRef.current === trackNumKey) {
          setExtAudioFileName(`${targetFile.name} [Аўдыя: ${codecTagToUse}]`);
          onExtAudioFileChange?.(audioFile);

          if (extAudioUrl) {
            URL.revokeObjectURL(extAudioUrl);
          }
          const newExtUrl = URL.createObjectURL(audioFile);
          setExtAudioUrl(newExtUrl);

          const isUnsupported = trackInfo?.isUnsupportedCodec ?? false;
          setRequiresTranscode(isUnsupported);
        }
      } else {
        setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
        addToast?.(`Файл ${targetFile.name}: Не ўдалося выцягнуць аўдыядарожку.`, 'error');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
      console.warn('Audio extraction failed:', err);
      addToast?.(`Файл ${targetFile.name}: Памылка апрацоўкі аўдыя.`, 'error');
    }
  };

  const downloadAudioFile = async (file: File, label?: string) => {
    const defaultName = file.name || (label ? `${label}.aac` : 'audio.aac');
    try {
      const savedPath = await saveFileUniversal(defaultName, file, file.type || 'audio/aac');
      if (savedPath) {
        addToast?.(`Файл "${defaultName}" паспяхова захаваны!`, 'success');
      }
    } catch (err) {
      console.error('Audio download error:', err);
      addToast?.(`Памылка захавання файла "${defaultName}".`, 'error');
    }
  };

  const deleteProcessedTrack = (trackNumber: number) => {
    setProcessedTracks((prev) => {
      const copy = { ...prev };
      delete copy[trackNumber];
      return copy;
    });
    if (activeTrackNumberRef.current === trackNumber && !activeExternalTrackId) {
      onExtAudioFileChange?.(null);
      setExtAudioFileName('');
      setRequiresTranscode(false);
    }
    addToast?.(`Апрацаванае аўдыя для дарожкі #${trackNumber} выдалена`, 'info');
  };

  const deleteExternalTrack = (id: string) => {
    setUploadedAudioTracks((prev) => prev.filter((t) => t.id !== id));
    if (activeExternalTrackId === id) {
      if (extAudioUrl) URL.revokeObjectURL(extAudioUrl);
      setExtAudioUrl('');
      setExtAudioFileName('');
      setActiveExternalTrackId(null);
      onExtAudioFileChange?.(null);
      if (availableAudioTracks.length > 0) {
        const defaultTr = availableAudioTracks[0];
        setActiveTrackNumberAndRef(defaultTr.trackNumber);
        setRequiresTranscode(defaultTr.isUnsupportedCodec || false);
      }
    }
    addToast?.('Знешняя аўдыядарожка выдалена', 'info');
  };

  const [subtitleFontSize, setSubtitleFontSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('subaka_player_subtitle_font_size');
      return saved ? parseInt(saved, 10) || 14 : 14;
    } catch {
      return 14;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('subaka_player_subtitle_font_size', subtitleFontSize.toString());
    } catch {}
  }, [subtitleFontSize]);
  
  // Clean up and reset media player when mediaFileName is cleared (e.g. via clear all button)
  useEffect(() => {
    if (!mediaFileName) {
      setMediaFile(null);
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl);
      }
      if (extAudioUrl) {
        URL.revokeObjectURL(extAudioUrl);
      }
      setMediaUrl('');
      setExtAudioUrl('');
      setExtAudioFileName('');
      setMediaType('none');
      setDuration(30);
      setProcessedTracks({});
      setActiveTrackNumber(null);
    }
  }, [mediaFileName]);

  // Ref to track media file switching for complete cleanup of previous audio tracks
  const prevMediaFileNameRef = useRef<string>(mediaFile?.name || mediaFileName || '');

  // Detect switching to a DIFFERENT media file: wipe all previous audio processing tracks
  useEffect(() => {
    const curName = mediaFile?.name || mediaFileName || '';
    if (curName && prevMediaFileNameRef.current && prevMediaFileNameRef.current !== curName) {
      if (extAudioUrl) {
        URL.revokeObjectURL(extAudioUrl);
      }
      setExtAudioUrl('');
      setExtAudioFileName('');
      setUploadedAudioTracks([]);
      setProcessedTracks({});
      setActiveExternalTrackId(null);
      setActiveTrackNumberAndRef(1);
      onExtAudioFileChange?.(null);
      if (audioAbortControllerRef.current) {
        audioAbortControllerRef.current.abort();
        audioAbortControllerRef.current = null;
      }
      terminateFFmpegWorker();
      setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
    }
    prevMediaFileNameRef.current = curName;
  }, [mediaFile, mediaFileName]);

  // Auto-synchronize mediaUrl with mediaFile prop (e.g. restored from storage on page refresh)
  useEffect(() => {
    if (mediaFile) {
      const ext = (mediaFile.name.toLowerCase().split('.').pop() || '').trim();
      
      const nativeAudioExts = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'mp2', 'm4b'];
      const unsupportedAudioExts = ['ac3', 'eac3', 'e-ac-3', 'dts', 'dtshd', 'truehd', 'thd', 'wma', 'ape', 'ra', 'pcm'];
      
      const isExplicitAudioType = mediaFile.type.startsWith('audio/') || 
        nativeAudioExts.includes(ext) || 
        unsupportedAudioExts.includes(ext) || 
        ext === 'mka';
      const isExplicitVideoType = mediaFile.type.startsWith('video/') || 
        ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm4v', 'flv', 'ogv', 'mts', 'm2ts', '3gp', 'ts'].includes(ext);

      // Distinguish video vs non-video (audio-only) files
      const isVideo = isExplicitVideoType && !isExplicitAudioType;

      const url = URL.createObjectURL(mediaFile);
      setMediaUrl(url);
      setMediaType(isVideo ? 'video' : 'audio');

      if (!isVideo) {
        // ===================================================================
        // NON-VIDEO (AUDIO-ONLY) FILE PROCESSING
        // ===================================================================
        const isNativeAudio = nativeAudioExts.includes(ext) || 
          (mediaFile.type.startsWith('audio/') && !unsupportedAudioExts.some(u => ext.includes(u) || mediaFile.type.includes(u)));

        if (isNativeAudio) {
          // Native audio plays directly with zero transcoding
          setRequiresTranscode(false);
          setActiveTrackNumberAndRef(1);
          setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });

          probeMkvAudioCodec(mediaFile).then((probe) => {
            if (probe.tracks && probe.tracks.length > 0) {
              setAvailableAudioTracks(probe.tracks);
            } else {
              setAvailableAudioTracks([{
                trackNumber: 1,
                codecId: ext.toUpperCase(),
                codecName: `${ext.toUpperCase()} (Натыўнае аўдыя)`,
                isDefault: true,
                channels: 2,
                isUnsupportedCodec: false,
              }]);
            }
          }).catch(() => {
            setAvailableAudioTracks([{
              trackNumber: 1,
              codecId: ext.toUpperCase(),
              codecName: `${ext.toUpperCase()} (Натыўнае аўдыя)`,
              isDefault: true,
              channels: 2,
              isUnsupportedCodec: false,
            }]);
          });
        } else {
          // Unsupported audio format (.ac3, .dts, .wma, etc.): requires transcoding
          setRequiresTranscode(true);
          if (audioAbortControllerRef.current) {
            audioAbortControllerRef.current.abort();
          }
          const controller = new AbortController();
          audioAbortControllerRef.current = controller;

          setAudioProcessingStatus({
            isProcessing: true,
            message: 'апрацоўка аўдыя 10%',
            progress: 10,
          });

          probeMkvAudioCodec(mediaFile).then((probe) => {
            if (probe.tracks && probe.tracks.length > 0) {
              setAvailableAudioTracks(probe.tracks);
            }
          }).catch(() => {});

          extractAudioWithFFmpeg(mediaFile, (p, msg) => {
            if (controller.signal.aborted) return;
            setAudioProcessingStatus({
              isProcessing: true,
              message: msg || (p !== null && p >= 0 ? `апрацоўка аўдыя ${p}%` : 'апрацоўка аўдыя...'),
              progress: p
            });
          }, controller.signal).then((ffResult) => {
            if (controller.signal.aborted) return;
            setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
            if (ffResult && ffResult.blob) {
              const trackUrl = URL.createObjectURL(ffResult.blob);
              setMediaUrl(trackUrl);
              const cleanAudioName = ffResult.fileName || (mediaFile.name.replace(/\.[^/.]+$/, '') + '.aac');
              const audioFile = new File([ffResult.blob], cleanAudioName, { type: ffResult.blob.type || 'audio/aac' });
              onExtAudioFileChange?.(audioFile);
              setRequiresTranscode(false);
              addToast?.(`Аўдыяфайл .${ext} паспяхова апрацаваны і гатовы да прайгравання!`, 'success');
            }
          }).catch((err) => {
            if (controller.signal.aborted) return;
            setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
            console.warn('FFmpeg standalone audio transcode failed:', err);
          });
        }
      } else {
        // ===================================================================
        // VIDEO FILE PROCESSING (MKV, MP4, AVI, MOV, WebM, etc.)
        // ===================================================================
        probeMkvAudioCodec(mediaFile).then((probe) => {
          if (probe.tracks && probe.tracks.length > 0) {
            setAvailableAudioTracks(probe.tracks);
            const chosenTrackNum = activeTrackNumberRef.current || activeTrackNumber || probe.audioTrackNumber || 1;
            const activeTr = probe.tracks.find(t => t.trackNumber === chosenTrackNum) || probe.tracks[0];
            if (activeTr) {
              setActiveTrackNumberAndRef(activeTr.trackNumber);
              const needsTc = activeTr.isUnsupportedCodec || probe.needsTranscode || false;
              setRequiresTranscode(needsTc);
              if (processedTracks[activeTr.trackNumber]) {
                const cached = processedTracks[activeTr.trackNumber];
                setExtAudioFileName(`${mediaFile.name} [Аўдыя: ${cached.label}]`);
                onExtAudioFileChange?.(cached.audioFile);
                if (extAudioUrl) URL.revokeObjectURL(extAudioUrl);
                setExtAudioUrl(URL.createObjectURL(cached.audioFile));
              } else if (needsTc && !extAudioFile) {
                executeAudioExtraction(activeTr.trackNumber, mediaFile);
              }
            } else {
              setRequiresTranscode(probe.needsTranscode || false);
              if (probe.needsTranscode && !extAudioFile) {
                executeAudioExtraction(probe.audioTrackNumber || 1, mediaFile);
              }
            }
          } else {
            setRequiresTranscode(probe.needsTranscode || false);
            if (probe.needsTranscode && !extAudioFile) {
              executeAudioExtraction(probe.audioTrackNumber || 1, mediaFile);
            }
          }
        }).catch(() => {
          setRequiresTranscode(false);
        });
      }

      return () => {
        if (audioAbortControllerRef.current) {
          audioAbortControllerRef.current.abort();
          audioAbortControllerRef.current = null;
        }
        URL.revokeObjectURL(url);
      };
    } else {
      if (audioAbortControllerRef.current) {
        audioAbortControllerRef.current.abort();
        audioAbortControllerRef.current = null;
      }
      setMediaUrl('');
      setMediaType('none');
      setRequiresTranscode(false);
      setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
      setAvailableAudioTracks([]);
      setExtAudioUrl('');
      setExtAudioFileName('');
      setUploadedAudioTracks([]);
    }
  }, [mediaFile]);

  // Auto-synchronize extAudioUrl with extAudioFile prop (e.g. restored from storage or extracted)
  useEffect(() => {
    if (extAudioFile) {
      const url = URL.createObjectURL(extAudioFile);
      setExtAudioUrl(url);
      setExtAudioFileName(extAudioFile.name);

      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setExtAudioUrl('');
      setExtAudioFileName('');
    }
  }, [extAudioFile]);

  // Auto-synchronize processedTracks when extAudioFile is present (e.g. restored on refresh)
  useEffect(() => {
    if (extAudioFile) {
      const match = extAudioFile.name.match(/_audio(\d+)/);
      const trackNum = match ? parseInt(match[1], 10) : (activeTrackNumber || 1);

      if (!processedTracks[trackNum]) {
        let label = 'Апрацаванае аўдыя';
        if (extAudioFileName) {
          const matchLabel = extAudioFileName.match(/\[Аўдыя:\s*(.*?)\]/);
          if (matchLabel) label = matchLabel[1];
        }
        setProcessedTracks((prev) => {
          if (prev[trackNum]) return prev;
          return {
            ...prev,
            [trackNum]: {
              blob: extAudioFile,
              audioFile: extAudioFile,
              label,
            },
          };
        });
      }
    }
  }, [extAudioFile, activeTrackNumber, extAudioFileName]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerStageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Media volume control (0.0 to 1.0) - controls video / background audio only, NOT subtitle voiceover
  const [mediaVolume, setMediaVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('subaka_media_volume');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0 && val <= 1) return val;
      }
    } catch {
      // ignore
    }
    return 1;
  });

  const [isMediaMuted, setIsMediaMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('subaka_media_muted') === 'true';
    } catch {
      // ignore
    }
    return false;
  });

  // Sync volume & mute to video and external/media audio elements (subtitle voiceover is separate and untouched)
  useEffect(() => {
    try {
      localStorage.setItem('subaka_media_volume', mediaVolume.toString());
      localStorage.setItem('subaka_media_muted', isMediaMuted.toString());
    } catch {
      // ignore
    }

    const effectiveVolume = isMediaMuted ? 0 : mediaVolume;

    if (videoRef.current) {
      videoRef.current.volume = effectiveVolume;
      videoRef.current.muted = !!extAudioUrl || isMediaMuted;
    }
    if (extAudioRef.current) {
      extAudioRef.current.volume = effectiveVolume;
      extAudioRef.current.muted = isMediaMuted;
    }
    if (audioRef.current) {
      audioRef.current.volume = effectiveVolume;
      audioRef.current.muted = isMediaMuted;
    }
  }, [mediaVolume, isMediaMuted, extAudioUrl, mediaUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
      if (!isNowFullscreen && isTauriDesktop()) {
        restorePostFullscreenBoundsDesktop();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!playerStageRef.current) return;
    if (!document.fullscreenElement) {
      playerStageRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  
  // Track last played audio URL to avoid repetitive triggers for the same line
  const lastTriggeredIdRef = useRef<string>('');
  const activeAudioInstanceRef = useRef<HTMLAudioElement | null>(null);

  const { currentTime, isPlaying, playbackSpeed, isSubtitlesOnlyPlay } = playbackState;

  // Process and load external audio track (e.g. from local file or Drive)
  const processExternalAudioFile = useCallback(async (file: File) => {
    if (extAudioUrl) {
      URL.revokeObjectURL(extAudioUrl);
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
    const isTranscodeNeeded = ['ac3', 'eac3', 'e-ac3', 'dts', 'truehd', 'dtshd'].includes(fileExt);

    let finalAudioFile: File = file;

    if (isTranscodeNeeded) {
      if (audioAbortControllerRef.current) {
        audioAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      audioAbortControllerRef.current = controller;

      setAudioProcessingStatus({
        isProcessing: true,
        message: 'апрацоўка аўдыя 10%',
        progress: 10,
      });
      addToast?.(`Фармат .${fileExt}: Запуск апрацоўкі аўдыядарожкі...`, 'info');
      try {
        const ffResult = await extractAudioWithFFmpeg(file, (p, msg) => {
          if (controller.signal.aborted) return;
          setAudioProcessingStatus({
            isProcessing: true,
            message: msg || (p !== null && p >= 0 ? `апрацоўка аўдыя ${p}%` : 'апрацоўка аўдыя...'),
            progress: p
          });
        }, controller.signal);
        if (controller.signal.aborted) return;
        setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
        if (ffResult && ffResult.blob) {
          const cleanName = file.name.replace(/\.[^/.]+$/, '') + '.aac';
          finalAudioFile = new File([ffResult.blob], cleanName, { type: ffResult.blob.type || 'audio/aac' });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setAudioProcessingStatus({ isProcessing: false, message: '', progress: null });
        console.warn('Ext audio FFmpeg conversion failed, fallback to raw file:', err);
      }
    }

    const trackId = 'ext_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const extTrack = {
      id: trackId,
      file: finalAudioFile,
      originalName: file.name,
      label: `Знешняе аўдыя: ${file.name}`
    };

    setUploadedAudioTracks(prev => [...prev, extTrack]);
    setActiveExternalTrackId(trackId);
    setSelectedTrackKey(trackId);
    setActiveTrackNumberAndRef(null);
    setRequiresTranscode(true);

    const url = URL.createObjectURL(finalAudioFile);
    setExtAudioUrl(url);
    setExtAudioFileName(extTrack.label);
    onExtAudioFileChange?.(finalAudioFile);
    addToast?.('Дадатковая аўдыядарожка дададзена: ' + file.name, 'success');
  }, [extAudioUrl, addToast, onExtAudioFileChange]);

  useEffect(() => {
    onRegisterAddExternalAudio?.(processExternalAudioFile);
  }, [onRegisterAddExternalAudio, processExternalAudioFile]);

  // Upload separate audio track (e.g. MP3/AAC/AC3/EAC3/M4A/DTS for MKV videos)
  const handleExtAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processExternalAudioFile(file);
  };

  // Synchronize actual HTML5 players with React state
  useEffect(() => {
    const activePlayer = mediaType === 'video' ? videoRef.current : (mediaType === 'audio' ? audioRef.current : null);
    if (!activePlayer) return;

    if (isPlaying) {
      if (Math.abs(activePlayer.currentTime - currentTime) > 0.08) {
        activePlayer.currentTime = currentTime;
      }
      if (extAudioRef.current && mediaType === 'video') {
        extAudioRef.current.currentTime = activePlayer.currentTime;
      }
      activePlayer.play().catch(() => {
        if (!audioProcessingStatus.isProcessing) {
          onPlaybackStateChange({ isPlaying: false });
        } else {
          addToast?.('Аўдыя апрацоўваецца, пачакайце...', 'info');
        }
      });
      if (extAudioRef.current && mediaType === 'video') {
        extAudioRef.current.currentTime = activePlayer.currentTime;
        extAudioRef.current.play().catch(() => {});
      }
    } else {
      activePlayer.pause();
      if (extAudioRef.current && mediaType === 'video') {
        extAudioRef.current.pause();
      }
    }
  }, [isPlaying, mediaType, extAudioUrl, mediaUrl, audioProcessingStatus.isProcessing]);

  // Strict Master (Video) -> Slave (External Audio) Event Synchronization
  useEffect(() => {
    const video = videoRef.current;
    const audio = extAudioRef.current;
    if (!video || !audio || mediaType !== 'video') return;

    const syncPlay = () => {
      audio.currentTime = video.currentTime;
      audio.playbackRate = video.playbackRate;
      audio.play().catch(() => {});
    };

    const syncPause = () => {
      audio.pause();
      // If the video is paused only because it is actively seeking/scrubbing, do not pause playback
      if (video && !video.seeking) {
        onPlaybackStateChange({ currentTime: video.currentTime, isPlaying: false });
      }
    };

    const syncSeek = () => {
      audio.currentTime = video.currentTime;
      if (video) {
        onPlaybackStateChange({ currentTime: video.currentTime });
      }
    };

    const syncRate = () => {
      audio.playbackRate = video.playbackRate;
    };

    const syncEnded = () => {
      if (video) {
        onPlaybackStateChange({ currentTime: video.currentTime, isPlaying: false });
      }
    };

    const syncTime = () => {
      // Keep audio tightly locked to video (100ms max allowed drift for perfect lip sync)
      if (Math.abs(audio.currentTime - video.currentTime) > 0.1) {
        audio.currentTime = video.currentTime;
      }
      if (video.paused) {
        onPlaybackStateChange({ currentTime: video.currentTime });
      }
    };

    video.addEventListener('play', syncPlay);
    video.addEventListener('playing', syncPlay);
    video.addEventListener('pause', syncPause);
    video.addEventListener('ended', syncEnded);
    video.addEventListener('seeking', syncSeek);
    video.addEventListener('seeked', syncSeek);
    video.addEventListener('ratechange', syncRate);
    video.addEventListener('timeupdate', syncTime);

    // Align initial states
    audio.playbackRate = video.playbackRate;
    audio.currentTime = video.currentTime;
    if (!video.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }

    return () => {
      video.removeEventListener('play', syncPlay);
      video.removeEventListener('playing', syncPlay);
      video.removeEventListener('pause', syncPause);
      video.removeEventListener('ended', syncEnded);
      video.removeEventListener('seeking', syncSeek);
      video.removeEventListener('seeked', syncSeek);
      video.removeEventListener('ratechange', syncRate);
      video.removeEventListener('timeupdate', syncTime);
    };
  }, [extAudioUrl, mediaType]);

  // Audio-only synchronization
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || mediaType !== 'audio') return;

    const onPause = () => {
      if (!audio.seeking) {
        onPlaybackStateChange({ currentTime: audio.currentTime, isPlaying: false });
      }
    };
    const onSeeked = () => {
      onPlaybackStateChange({ currentTime: audio.currentTime });
    };
    const onEnded = () => {
      onPlaybackStateChange({ currentTime: audio.currentTime, isPlaying: false });
    };
    const onTimeUpdate = () => {
      if (audio.paused) {
        onPlaybackStateChange({ currentTime: audio.currentTime });
      }
    };

    audio.addEventListener('pause', onPause);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);

    return () => {
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [mediaType, mediaUrl]);

  // Handle playback speed changes
  useEffect(() => {
    const activePlayer = mediaType === 'video' ? videoRef.current : (mediaType === 'audio' ? audioRef.current : null);
    if (!activePlayer) return;

    activePlayer.playbackRate = playbackSpeed;
    if (extAudioRef.current) {
      extAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, mediaType, extAudioUrl]);

  // Sync state currentTime changes from outside (manual seek or selection jumps) to actual HTML5 elements
  const lastTimeRef = useRef<number>(currentTime);
  const localTimeRef = useRef<number>(currentTime);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    // Keep localTimeRef in sync with external currentTime prop changes (e.g. manual seek or selection jumps)
    if (!isPlaying || Math.abs(localTimeRef.current - currentTime) > 0.15) {
      localTimeRef.current = currentTime;
    }
  }, [currentTime, isPlaying]);

  useEffect(() => {
    const diff = Math.abs(currentTime - lastTimeRef.current);
    // If the difference is larger than a standard play progression step, it's a manual jump
    const threshold = 0.2;
    if (diff > threshold) {
      lastTriggeredIdRef.current = '';
      const activePlayer = mediaType === 'video' ? videoRef.current : (mediaType === 'audio' ? audioRef.current : null);
      if (activePlayer && Math.abs(activePlayer.currentTime - currentTime) > threshold) {
        activePlayer.currentTime = currentTime;
      }
      if (extAudioRef.current && Math.abs(extAudioRef.current.currentTime - currentTime) > threshold) {
        extAudioRef.current.currentTime = currentTime;
      }
    }
    lastTimeRef.current = currentTime;
  }, [currentTime, mediaType, extAudioUrl]);

  // Precompute numeric seconds for subtitles to avoid string parsing overhead in playback loops
  const parsedSubtitles = useMemo(() => {
    return subtitles.map((sub, index) => ({
      index,
      sub,
      startSec: srtTimeToSeconds(sub.startTime),
      endSec: srtTimeToSeconds(sub.endTime),
    }));
  }, [subtitles]);

  // Active smooth play loop using requestAnimationFrame with throttled state updates
  useEffect(() => {
    let animationFrameId: number;

    if (isPlaying) {
      lastTickRef.current = performance.now();
      let lastReportTime = 0;

      const updateLoop = () => {
        const now = performance.now();

        if (mediaType !== 'none') {
          const activePlayer = mediaType === 'video' ? videoRef.current : audioRef.current;
          if (activePlayer) {
            // Throttle UI currentTime updates to ~30fps (~33ms) during media playback
            // Keeps playback UI completely smooth while saving up to 75% CPU cycles
            if (now - lastReportTime >= 33 || activePlayer.paused) {
              lastReportTime = now;
              onPlaybackStateChange({ currentTime: activePlayer.currentTime });
            }

            // Active smooth playback drift correction (only on major desync > 0.4s)
            if (mediaType === 'video' && extAudioRef.current && !activePlayer.paused) {
              const drift = Math.abs(extAudioRef.current.currentTime - activePlayer.currentTime);
              if (drift > 0.4) {
                extAudioRef.current.currentTime = activePlayer.currentTime;
              }
              if (extAudioRef.current.paused) {
                extAudioRef.current.play().catch(() => {});
              }
            }
          }
        } else {
          const elapsed = ((now - lastTickRef.current) / 1000) * playbackSpeed;
          lastTickRef.current = now;

          localTimeRef.current = Math.min(localTimeRef.current + elapsed, duration);
          onPlaybackStateChange({ currentTime: localTimeRef.current });

          if (localTimeRef.current >= duration) {
            onPlaybackStateChange({ isPlaying: false });
            return; // stop progression loop
          }
        }
        animationFrameId = requestAnimationFrame(updateLoop);
      };

      animationFrameId = requestAnimationFrame(updateLoop);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, mediaType, playbackSpeed, duration]);

  // Synchronise simulated duration based on subtitle end timestamp if there's no physical file
  const lastSubEndTime = subtitles.length > 0 ? subtitles[subtitles.length - 1]?.endTime : '';
  useEffect(() => {
    if (mediaType === 'none' && parsedSubtitles.length > 0) {
      const maxSubTime = parsedSubtitles.reduce((max, item) => {
        return item.endSec > max ? item.endSec : max;
      }, 30);
      setDuration((prev) => (Math.abs(prev - (maxSubTime + 3)) > 0.5 ? maxSubTime + 3 : prev));
    }
  }, [parsedSubtitles, mediaType, lastSubEndTime]);

  // Track active subtitle matching the currentTime during active playback
  useEffect(() => {
    if (parsedSubtitles.length === 0 || !isPlaying) return;

    let foundIndex = parsedSubtitles.findIndex(
      (item) => currentTime >= item.startSec && currentTime < item.endSec
    );

    if (foundIndex === -1) {
      // If currentTime is between subtitles or beyond, find the subtitle that started most recently
      for (let i = parsedSubtitles.length - 1; i >= 0; i--) {
        if (currentTime >= parsedSubtitles[i].startSec) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex !== -1 && foundIndex !== activeSubtitleIndex) {
      onSelectSubtitle(foundIndex);
    }
  }, [currentTime, parsedSubtitles, activeSubtitleIndex, isPlaying]);

  // Auto-play TTS voiceover on timeline progression
  useEffect(() => {
    if (!isSubtitlesOnlyPlay || !isPlaying) {
      return;
    }

    // Find the currently active subtitle matching timestamps
    const activeItem = parsedSubtitles.find(
      (item) => currentTime >= item.startSec && currentTime < item.endSec
    );
    const activeSub = activeItem?.sub;

    // Run trigger if subtitle is found and hasn't just been played
    if (activeSub) {
      if (lastTriggeredIdRef.current !== activeSub.id) {
        lastTriggeredIdRef.current = activeSub.id;
        
        // Cancel previous playback if any
        if (activeAudioInstanceRef.current) {
          activeAudioInstanceRef.current.pause();
        }

        if (activeSub.audioUrl) {
          const audio = new Audio(activeSub.audioUrl);
          activeAudioInstanceRef.current = audio;
          
          // Match voiceover playback rates if requested, factored by the card's specific audio speed
          const customSpeed = activeSub.audioSpeed || 1.0;
          audio.playbackRate = playbackSpeed * customSpeed;
          audio.play().catch(e => {
            if (e.name === 'AbortError' || e.message?.includes('interrupted') || e.message?.includes('pause')) {
              console.log("Voiceover playback interrupted as expected.");
            } else {
              console.error("Error auto-playing voiceover:", e);
            }
          });
        }
      }
    } else {
      lastTriggeredIdRef.current = null;
    }
  }, [currentTime, isSubtitlesOnlyPlay, parsedSubtitles, isPlaying, playbackSpeed]);

  const handleSeek = (newTime: number) => {
    onPlaybackStateChange({ currentTime: newTime });
    
    // Seek actual physical player if attached
    const activePlayer = mediaType === 'video' ? videoRef.current : (mediaType === 'audio' ? audioRef.current : null);
    if (activePlayer) {
      activePlayer.currentTime = newTime;
    }
    
    // Clear last trigger to allow replaying on seek
    lastTriggeredIdRef.current = '';

    // If seeking explicitly, select matching subtitle
    const foundIdx = parsedSubtitles.findIndex(
      (item) => newTime >= item.startSec && newTime < item.endSec
    );
    if (foundIdx !== -1) {
      onSelectSubtitle(foundIdx);
    }
  };

  const handleJumpToPrevSubtitle = () => {
    if (parsedSubtitles.length === 0) return;

    let targetIndex = -1;
    const currentSubIndex = parsedSubtitles.findIndex((item) => {
      return currentTime >= item.startSec && currentTime <= item.endSec;
    });

    if (currentSubIndex !== -1) {
      const currentStart = parsedSubtitles[currentSubIndex].startSec;
      if (currentTime > currentStart + 0.8) {
        targetIndex = currentSubIndex;
      } else {
        targetIndex = Math.max(0, currentSubIndex - 1);
      }
    } else {
      for (let i = parsedSubtitles.length - 1; i >= 0; i--) {
        if (parsedSubtitles[i].startSec < currentTime - 0.1) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex === -1) targetIndex = 0;
    }

    if (targetIndex !== -1 && parsedSubtitles[targetIndex]) {
      const targetTime = parsedSubtitles[targetIndex].startSec;
      handleSeek(targetTime);
      onSelectSubtitle(targetIndex);
    }
  };

  const handleJumpToNextSubtitle = () => {
    if (parsedSubtitles.length === 0) return;

    let targetIndex = -1;
    for (let i = 0; i < parsedSubtitles.length; i++) {
      if (parsedSubtitles[i].startSec > currentTime + 0.1) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1 && parsedSubtitles[targetIndex]) {
      const targetTime = parsedSubtitles[targetIndex].startSec;
      handleSeek(targetTime);
      onSelectSubtitle(targetIndex);
    }
  };

  const currentSubtitle = useMemo(() => {
    if (parsedSubtitles.length === 0) return null;
    return parsedSubtitles.find(
      (item) => currentTime >= item.startSec && currentTime < item.endSec
    )?.sub || null;
  }, [currentTime, parsedSubtitles]);

  // Format second counts in standard subtitle timestamp format HH:MM:SS,MS (SRT format)
  // so it can be seamlessly copied and pasted directly into subtitle cards
  const formatTime = (seconds: number) => {
    return secondsToSrtTime(seconds);
  };

  return (
    <div 
      id="timeline-player-container" 
      ref={playerStageRef}
      className={`${
        theme === 'dark' ? 'bg-slate-900 border-slate-800/80 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      } border rounded-2xl overflow-hidden p-3 sm:p-4 flex flex-col gap-3 @container ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen rounded-none p-6 justify-between' : 'w-full shrink-0 lg:shrink lg:h-full lg:flex-1 min-h-fit lg:min-h-0'
      } transition-colors duration-200`}
    >
      <div className={`flex items-center justify-between border-b pb-2 gap-1.5 sm:gap-2.5 min-w-0 ${
        theme === 'dark' ? 'border-slate-800/60' : 'border-slate-200'
      }`}>
        {/* Media Status Card */}
        <div 
          className="flex items-center gap-1.5 min-w-0 flex-1 py-1 px-0.5 select-none max-w-[180px] @[480px]:max-w-[260px] @[640px]:max-w-[340px] shrink bg-transparent border-none" 
          title={mediaFileName || "Медыяфайл не загружаны"}
        >
          {mediaLoadingProgress !== null ? (
            // Loading state
            <div className="flex items-center gap-2 w-full min-w-0">
              <span className={`text-[10px] font-medium whitespace-nowrap truncate ${theme === 'dark' ? 'text-slate-350' : 'text-slate-700'}`}>
                Загрузка: <span className={`font-mono font-bold ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>{mediaLoadingProgress}%</span>
              </span>
              <div className={`w-16 rounded-full h-1 overflow-hidden border shrink-0 hidden @[400px]:block ${
                theme === 'dark' ? 'bg-slate-950/80 border-slate-900' : 'bg-slate-200 border-slate-300'
              }`}>
                <div 
                  className={`h-full transition-all duration-150 ease-out ${theme === 'dark' ? 'bg-amber-400' : 'bg-amber-600'}`} 
                  style={{ width: `${mediaLoadingProgress}%` }}
                />
              </div>
            </div>
          ) : mediaFileName ? (
            // Loaded state
            <div className="flex items-center gap-2 w-full min-w-0">
              <span 
                className={`font-semibold whitespace-nowrap truncate transition-all ${
                  mediaFileName.length > 55
                    ? 'text-[7.5px] leading-tight'
                    : mediaFileName.length > 40
                      ? 'text-[8px] leading-tight'
                      : mediaFileName.length > 25
                        ? 'text-[9px] leading-tight'
                        : 'text-[10px]'
                } ${theme === 'dark' ? 'text-slate-300' : 'text-slate-900'}`} 
                title={mediaFileName}
              >
                {mediaFileName}
              </span>
            </div>
          ) : (
            // Empty state
            <div className={`flex items-center gap-1.5 w-full min-w-0 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>
              <Film className="h-3 w-3 shrink-0 opacity-60" />
              <span className="text-[9px] @[440px]:text-[10px] font-medium tracking-tight whitespace-nowrap truncate">
                медыяфайл не загружаны
              </span>
            </div>
          )}
        </div>
        
        {/* Audio Track Selector - ALWAYS ACTIVE when media is loaded */}
        <button
          type="button"
          disabled={!mediaFileName && !mediaFile}
          onClick={async () => {
            if (!mediaFile && !mediaFileName) return;
            if (mediaFile && availableAudioTracks.length === 0) {
              try {
                const probe = await probeMkvAudioCodec(mediaFile);
                if (probe.tracks && probe.tracks.length > 0) {
                  setAvailableAudioTracks(probe.tracks);
                }
              } catch {}
            }
            if (activeExternalTrackId) {
              setSelectedTrackKey(activeExternalTrackId);
            } else if (activeTrackNumberRef.current) {
              setSelectedTrackKey(`embedded_${activeTrackNumberRef.current}`);
            } else if (availableAudioTracks.length > 0) {
              setSelectedTrackKey(`embedded_${availableAudioTracks[0].trackNumber}`);
            } else {
              setSelectedTrackKey('embedded_1');
            }
            setShowAudioTrackSelectModal(true);
          }}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded border flex items-center gap-1.5 transition-all whitespace-nowrap shadow select-none shrink-0 ${
            !mediaFileName && !mediaFile
              ? 'opacity-50 cursor-not-allowed border-slate-700/40 text-slate-400 bg-slate-800/20'
              : audioProcessingStatus.isProcessing
                ? theme === 'dark'
                  ? 'animate-pulse text-amber-300 bg-amber-950/70 border-amber-500/80 shadow-amber-500/20 cursor-pointer'
                  : 'animate-pulse text-amber-950 bg-amber-200 border-amber-500 shadow-amber-900/10 font-bold cursor-pointer'
                : theme === 'dark'
                  ? 'text-indigo-300 hover:text-white bg-indigo-950/50 hover:bg-indigo-900/70 border-indigo-500/40 cursor-pointer'
                  : 'text-indigo-900 hover:text-indigo-950 bg-indigo-100 hover:bg-indigo-200 border-indigo-300 font-bold cursor-pointer'
          }`}
          title="Выбраць або загрузіць аўдыядарожку"
        >
          {audioProcessingStatus.isProcessing ? (
            <>
              <Loader2 className={`h-3 w-3 animate-spin shrink-0 ${theme === 'dark' ? 'text-amber-400' : 'text-amber-800'}`} />
              <span className="hidden @[560px]:inline">выбраць аўдыядарожку</span>
              <span className="@[560px]:hidden">дарожка</span>
              {audioProcessingStatus.progress !== null && audioProcessingStatus.progress >= 0 ? ` (${Math.round(audioProcessingStatus.progress)}%)` : ' (апрацоўка...)'}
            </>
          ) : (
            <>
              <Volume2 className="h-3 w-3 text-indigo-400 shrink-0" />
              <span className="hidden @[560px]:inline">выбраць аўдыядарожку</span>
              <span className="@[560px]:hidden">дарожка</span>
              {modalTrackList.length > 0 ? ` (${modalTrackList.length})` : ''}
            </>
          )}
        </button>
      </div>

      {/* Main Preview Screen */}
      <div 
        className={`relative w-full aspect-video shrink-0 lg:shrink lg:aspect-auto lg:flex-1 ${
          isFullscreen ? 'max-h-none flex-1 h-full w-full' : 'min-h-[180px] sm:min-h-[220px] max-h-[360px] lg:max-h-none'
        } bg-slate-950 rounded-lg flex items-center justify-center overflow-hidden border border-slate-900 shadow-inner group mx-auto`}
      >
        
        {/* Real Video Player */}
        {mediaType === 'video' && (
          <>
            <video
              ref={videoRef}
              src={mediaUrl || undefined}
              muted={!!extAudioUrl || isMediaMuted}
              className="w-full h-full object-contain"
              onLoadedMetadata={() => {
                setDuration(videoRef.current?.duration || 30);
                if (videoRef.current) {
                  videoRef.current.volume = isMediaMuted ? 0 : mediaVolume;
                  videoRef.current.muted = !!extAudioUrl || isMediaMuted;
                  if (currentTime > 0) {
                    videoRef.current.currentTime = currentTime;
                  }
                }
              }}
              onCanPlay={() => {
                if (videoRef.current && currentTime > 0 && Math.abs(videoRef.current.currentTime - currentTime) > 0.15 && videoRef.current.paused) {
                  videoRef.current.currentTime = currentTime;
                }
              }}
              onClick={() => onPlaybackStateChange({ isPlaying: !isPlaying })}
            />
            {extAudioUrl ? (
              <audio 
                ref={extAudioRef} 
                src={extAudioUrl || undefined} 
                preload="auto" 
                muted={isMediaMuted}
                onLoadedMetadata={() => {
                  if (extAudioRef.current) {
                    extAudioRef.current.volume = isMediaMuted ? 0 : mediaVolume;
                    extAudioRef.current.muted = isMediaMuted;
                    if (videoRef.current) {
                      extAudioRef.current.currentTime = videoRef.current.currentTime;
                      extAudioRef.current.playbackRate = videoRef.current.playbackRate;
                    } else if (currentTime > 0) {
                      extAudioRef.current.currentTime = currentTime;
                    }
                    if (isPlaying) {
                      extAudioRef.current.play().catch(() => {});
                    }
                  }
                }}
              />
            ) : null}
          </>
        )}

        {/* Real Audio Player */}
        {mediaType === 'audio' && (
          <div className="flex flex-col items-center justify-center gap-4 text-center p-6 w-full h-full">
            <audio
              ref={audioRef}
              src={mediaUrl || undefined}
              muted={isMediaMuted}
              onLoadedMetadata={() => {
                setDuration(audioRef.current?.duration || 30);
                if (audioRef.current) {
                  audioRef.current.volume = isMediaMuted ? 0 : mediaVolume;
                  audioRef.current.muted = isMediaMuted;
                  if (currentTime > 0) {
                    audioRef.current.currentTime = currentTime;
                  }
                }
              }}
              onCanPlay={() => {
                if (audioRef.current && currentTime > 0 && Math.abs(audioRef.current.currentTime - currentTime) > 0.15 && audioRef.current.paused) {
                  audioRef.current.currentTime = currentTime;
                }
              }}
            />
            <div className="p-4 bg-indigo-600/10 rounded-full text-indigo-400 border border-indigo-500/10 shadow-lg glow">
              <Music className="h-12 w-12 animate-pulse" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-slate-200">{mediaFile?.name}</p>
              <p className="text-xs text-slate-500 mt-1">аўдыя загружана</p>
            </div>
          </div>
        )}

        {/* Ambient watermark/logo when no media file is loaded */}
        {mediaType === 'none' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/60" />
            <div className="relative z-10 flex items-center justify-center w-[35%] h-[35%] opacity-[0.45] hover:opacity-75 transition-opacity duration-200">
              <img 
                src="/player-watermark.svg"
                alt="СУБАКА"
                className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(168,85,247,0.3)]"
                aria-hidden="true"
                draggable={false}
              />
            </div>
          </div>
        )}

        {/* Dynamic Subtitle overlay - Original at the top, Belarusian Translation at the bottom */}
        {currentSubtitle && (
          <>
            {/* User Subtitle */}
            {showActorsOnPlayer && (
              <>
                {/* User Subtitle Original Up border border-slate-700/0 font-semibold shadow-md */}
                {currentSubtitle.originalActor?.trim() && (
                  <div className="absolute top-0 left-0 sm:top-0 sm:left-0 max-w-[28%] sm:max-w-[32%] z-30 pointer-events-auto">
                    <div 
                      style={{ fontSize: `${Math.max(8, subtitleFontSize - 2)}px` }}
                      className="inline-flex items-center gap-0.5 px-0.5 py-[1px] rounded-md [filter:drop-shadow(0_1px_0_rgba(0,0,0,0.6))_drop-shadow(0_-1px_0_rgba(0,0,0,0.6))_drop-shadow(1px_0_0_rgba(0,0,0,0.6))_drop-shadow(-1px_0_0_rgba(0,0,0,0.6))]  text-blue-200 truncate animate-fade-in"
                    >
                      <User 
                        style={{ width: `${Math.max(8, subtitleFontSize - 2)}px`, height: `${Math.max(8, subtitleFontSize - 2)}px` }} 
                        className="text-blue-200 shrink-0" 
                      />
                      <span className="truncate">{currentSubtitle.originalActor.trim()}</span>
                    </div>
                  </div>
                )}

                {/* User Subtitle Translated Down border border-amber-500/0 font-semibold shadow-md */}
                {currentSubtitle.actor?.trim() && (
                  <div className="absolute bottom-0 left-0 sm:bottom-0 sm:left-0 max-w-[28%] sm:max-w-[32%] z-30 pointer-events-auto">
                    <div 
                      style={{ fontSize: `${Math.max(8, subtitleFontSize - 2)}px` }}
                      className="inline-flex items-center gap-0.5 px-0.5 py-[1px] rounded-md [filter:drop-shadow(0_1px_0_rgba(0,0,0,0.6))_drop-shadow(0_-1px_0_rgba(0,0,0,0.6))_drop-shadow(1px_0_0_rgba(0,0,0,0.6))_drop-shadow(-1px_0_0_rgba(0,0,0,0.6))]  text-amber-200 truncate animate-fade-in"
                    >
                      <User 
                        style={{ width: `${Math.max(8, subtitleFontSize - 2)}px`, height: `${Math.max(8, subtitleFontSize - 2)}px` }} 
                        className="text-amber-200 shrink-0" 
                      />
                      <span className="truncate">{currentSubtitle.actor.trim()}</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Subtitle Original Up bg-black/0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] border border-blue-500/10*/}
            {currentSubtitle.text && (
              <div className="absolute top-2 sm:top-4 inset-x-2 sm:inset-x-4 @[600px]:inset-x-8 pointer-events-none z-20 flex justify-center items-start">
                <div className="w-full text-center">
                  <p 
                    style={{ fontSize: `${Math.max(8, subtitleFontSize + 3)}px`, fontFamily: 'Arial, Helvetica, sans-serif' }}
                    className="font-bold text-blue-200 inline-block px-1.5 py-0.25 rounded-lg [filter:drop-shadow(0_2px_0_rgba(0,0,0,0.6))_drop-shadow(0_-2px_0_rgba(0,0,0,0.6))_drop-shadow(2px_0_0_rgba(0,0,0,0.6))_drop-shadow(-2px_0_0_rgba(0,0,0,0.6))] animate-fade-in max-w-full break-words text-center tracking-wide leading-snug pointer-events-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizeSrtHtml(currentSubtitle.text) }}
                  />
                </div>
              </div>
            )}

            {/* Subtitle Translated Down bg-black/0 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] border border-amber-500/10*/}
            {currentSubtitle.translatedText && (
              <div className="absolute bottom-2 sm:bottom-4 inset-x-2 sm:inset-x-4 @[600px]:inset-x-8 pointer-events-none z-20 flex justify-center items-end">
                <div className="w-full text-center">
                  <p 
                    style={{ fontSize: `${Math.max(8, subtitleFontSize + 3)}px`, fontFamily: 'Arial, Helvetica, sans-serif' }}
                    className="font-bold text-amber-200 inline-block px-1.5 py-0.25 rounded-lg [filter:drop-shadow(0_2px_0_rgba(0,0,0,0.6))_drop-shadow(0_-2px_0_rgba(0,0,0,0.6))_drop-shadow(2px_0_0_rgba(0,0,0,0.6))_drop-shadow(-2px_0_0_rgba(0,0,0,0.6))] animate-fade-in max-w-full break-words text-center tracking-wide leading-snug pointer-events-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizeSrtHtml(currentSubtitle.translatedText) }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Timeline Controls */}
      <div className="flex flex-col gap-2.5">
        {/* Slider Bar */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span 
            className={`text-[8.5px] leading-[12.25px] font-mono font-bold shrink-0 min-w-[76px] select-all cursor-text ${
              theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-neutral-600 hover:text-neutral-900'
            } transition-colors`}
            title="Бягучы час у фармаце субцітраў (можна капіраваць і ўставіць у картку)"
          >
            {formatTime(currentTime)}
          </span>
          <input
            id="timeline-scrollbar-slider"
            type="range"
            min="0"
            max={duration || 30}
            step="0.01"
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className={`flex-1 accent-amber-500 h-1.5 rounded-lg cursor-pointer ${
              theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200'
            }`}
          />
          <span 
            className={`text-[8.5px] leading-[12.25px] font-mono font-bold shrink-0 min-w-[76px] text-right select-all cursor-text ${
              theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-neutral-600 hover:text-neutral-900'
            } transition-colors`}
            title="Агульны час у фармаце субцітраў (можна капіраваць і ўставіць у картку)"
          >
            {formatTime(duration)}
          </span>
        </div>

        {/* Buttons board */}
        <div className={`flex flex-col gap-2.5 pt-1.5 border-t ${
          theme === 'dark' ? 'border-slate-700/30' : 'border-slate-200'
        }`}>
          {/* Player controls & toggles & speed */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onPlaybackStateChange({ isPlaying: !isPlaying })}
                className={`p-2 rounded-lg transition-all shadow ${
                  isPlaying 
                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
                title={isPlaying ? "Паўза" : "Прайграць"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              {/* Skip to Previous Subtitle */}
              <button
                onClick={handleJumpToPrevSubtitle}
                disabled={subtitles.length === 0}
                className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
                  subtitles.length === 0
                    ? 'opacity-40 cursor-not-allowed text-slate-600'
                    : theme === 'dark'
                      ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700/60'
                      : 'bg-slate-100 hover:bg-slate-200 text-amber-700 border border-slate-300'
                }`}
                title="Пераскочыць да папярэдняга субцітра (да пачатку карткі)"
              >
                <SkipBack className="h-4 w-4" />
              </button>

              <button
                onClick={() => handleSeek(Math.max(0, currentTime - 10))}
                className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                }`}
                title="Пераматаць на 10 секунд назад"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="text-[10px] font-bold">10с</span>
              </button>

              <button
                onClick={() => handleSeek(Math.min(duration, currentTime + 10))}
                className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                }`}
                title="Пераматаць на 10 секунд наперад"
              >
                <RotateCw className="h-4 w-4" />
                <span className="text-[10px] font-bold">10с</span>
              </button>

              {/* Skip to Next Subtitle */}
              <button
                onClick={handleJumpToNextSubtitle}
                disabled={subtitles.length === 0}
                className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
                  subtitles.length === 0
                    ? 'opacity-40 cursor-not-allowed text-slate-600'
                    : theme === 'dark'
                      ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700/60'
                      : 'bg-slate-100 hover:bg-slate-200 text-amber-700 border border-slate-300'
                }`}
                title="Пераскочыць да наступнага субцітра"
              >
                <SkipForward className="h-4 w-4" />
              </button>

              {/* Subtitle Font Size Control Button with Up/Down arrows */}
              <div 
                className={`px-1.5 py-1 rounded-lg transition-colors flex items-center gap-1 border ${
                  theme === 'dark'
                    ? 'bg-slate-800 border-slate-700/60 text-slate-300'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
                title="Памер субцітраў на плэеры"
              >
                <Type className={`h-3.5 w-3.5 shrink-0 ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`} />
                <span className="text-[10px] font-bold font-mono px-0.5">{subtitleFontSize}px</span>
                <div className="flex flex-col border-l border-slate-700/40 pl-0.5">
                  <button
                    onClick={() => setSubtitleFontSize((prev) => Math.min(36, prev + 1))}
                    className={`p-px rounded transition-colors ${
                      theme === 'dark' ? 'text-slate-400 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                    }`}
                    title="Павялічыць памер субцітраў"
                  >
                    <ChevronUp className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => setSubtitleFontSize((prev) => Math.max(8, prev - 1))}
                    className={`p-px rounded transition-colors ${
                      theme === 'dark' ? 'text-slate-400 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                    }`}
                    title="Паменшыць памер субцітраў"
                  >
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>

              {/* Fullscreen Player Button */}
              <button
                onClick={toggleFullscreen}
                className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                }`}
                title={isFullscreen ? "Выйсці з поўнаэкраннага рэжыму" : "Поўнаэкранны рэжым плэера"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>

              {/* Media Volume Slider (only controls video/audio track, does not affect subtitle voiceover) */}
              <div 
                className={`px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 border ${
                  theme === 'dark'
                    ? 'bg-slate-800 border-slate-700/60 text-slate-300'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
                title={`Гучнасць відэа/аўдыя: ${isMediaMuted ? 'выключана' : `${Math.round(mediaVolume * 100)}%`} (не ўплывае на агучку субцітраў)`}
              >
                <button
                  type="button"
                  onClick={() => setIsMediaMuted(prev => !prev)}
                  className={`p-0.5 rounded transition-colors ${
                    theme === 'dark' ? 'text-slate-400 hover:text-amber-400' : 'text-slate-600 hover:text-amber-600'
                  }`}
                  title={isMediaMuted ? "Уключыць гук відэа/аўдыя" : "Выключыць гук відэа/аўдыя"}
                >
                  {isMediaMuted || mediaVolume === 0 ? (
                    <VolumeX className="h-4 w-4 text-rose-400" />
                  ) : mediaVolume < 0.5 ? (
                    <Volume1 className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMediaMuted ? 0 : mediaVolume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setMediaVolume(val);
                    if (isMediaMuted && val > 0) {
                      setIsMediaMuted(false);
                    }
                  }}
                  className="w-16 sm:w-20 h-1.5 accent-amber-500 rounded-lg cursor-pointer"
                  aria-label="Гучнасць відэа"
                />
                <span className="text-[10px] font-mono font-medium text-slate-400 w-7 text-right select-none">
                  {isMediaMuted ? '0%' : `${Math.round(mediaVolume * 100)}%`}
                </span>
              </div>

              {/* Extract Subtitles button - active ONLY when file has embedded subtitles */}
              <button
                onClick={handleExtractAndImportSrt}
                disabled={!hasEmbeddedSubtitles || isExtractingSrt || !mediaFile}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md border transition-all flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0 ${
                  isExtractingSrt
                    ? 'bg-amber-400 text-slate-950 border-amber-300 font-extrabold cursor-wait !opacity-100'
                    : hasEmbeddedSubtitles && mediaFile
                      ? theme === 'dark'
                        ? 'bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border-amber-500/30 font-bold ring-1 ring-amber-500/20 cursor-pointer'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 font-bold cursor-pointer'
                      : theme === 'dark'
                        ? 'bg-slate-900/40 text-slate-500 border-slate-800/60 cursor-not-allowed opacity-50'
                        : 'bg-slate-100/60 text-slate-400 border-slate-200 cursor-not-allowed opacity-50'
                }`}
                title={
                  isExtractingSrt
                    ? (srtProcessingProgress ? `${srtProcessingProgress} (${srtProcessingPercent}%)` : `Апрацоўка субцітраў ${srtProcessingPercent}%...`)
                    : hasEmbeddedSubtitles
                      ? "Выцягнуць убудаваныя субцітры з медыяфайла і дадаць у працоўную вобласць"
                      : mediaFile
                        ? "У зыходным файле не выяўлена ўбудаваных субцітраў"
                        : "Загрузіце медыяфайл з убудаванымі субцітрамі"
                }
              >
                {isExtractingSrt ? (
                  <RefreshCw className="h-3 w-3 animate-spin text-slate-950 shrink-0 stroke-[2.5]" />
                ) : (
                  <Download className={`h-3 w-3 shrink-0 ${hasEmbeddedSubtitles && mediaFile ? 'text-amber-500' : 'text-slate-500 opacity-60'}`} />
                )}
                <span>
                  {isExtractingSrt ? `... ${srtProcessingPercent}%` : "субцітры"}
                </span>
              </button>

              {/* Voiceover and Roles player toggles arranged vertically */}
              <div className="flex flex-col justify-center gap-0.5 select-none shrink-0 py-0.5">
                {/* Voiceover live playback toggle */}
                <label
                  className={`flex items-center gap-1 select-none cursor-pointer transition-colors ${
                    theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Прайграваць агучанае ў плэеры"
                >
                  <input
                    type="checkbox"
                    id="player-voiceover-autoplay-checkbox"
                    title="Прайграваць агучанае ў плэеры"
                    checked={!!isSubtitlesOnlyPlay}
                    onChange={(e) => onPlaybackStateChange({ isSubtitlesOnlyPlay: e.target.checked })}
                    className="sr-only"
                  />
                  <div
                    className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                      isSubtitlesOnlyPlay
                        ? 'border-amber-500 bg-amber-500/20 shadow-[0_0_4px_rgba(245,158,11,0.4)]'
                        : theme === 'dark'
                        ? 'border-slate-600 bg-slate-950/60'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSubtitlesOnlyPlay && (
                      <div className="w-1 h-1 rounded-full bg-amber-500" />
                    )}
                  </div>
                  <span className="text-[9px] font-medium leading-none whitespace-nowrap">
                    агучка
                  </span>
                </label>

                {/* Roles on player toggle */}
                <label
                  className={`flex items-center gap-1 select-none cursor-pointer transition-colors ${
                    theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Паказваць ролі на плэеры"
                >
                  <input
                    type="checkbox"
                    id="player-show-actors-checkbox"
                    checked={!!showActorsOnPlayer}
                    onChange={(e) => onToggleShowActorsOnPlayer?.(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                      showActorsOnPlayer
                        ? 'border-amber-500 bg-amber-500/20 shadow-[0_0_4px_rgba(245,158,11,0.4)]'
                        : theme === 'dark'
                        ? 'border-slate-600 bg-slate-950/60'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {showActorsOnPlayer && (
                      <div className="w-1 h-1 rounded-full bg-amber-500" />
                    )}
                  </div>
                  <span className="text-[9px] font-medium leading-none whitespace-nowrap">
                    ролі
                  </span>
                </label>
              </div>

              {/* Playback speed selector dropdown (opens upward) */}
              <div className="relative" ref={speedMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowSpeedMenu((prev) => !prev)}
                  title="Хуткасць прайгравання"
                  className={`h-6 px-1.5 text-[9.5px] font-bold rounded border flex items-center justify-between gap-0.5 cursor-pointer transition-colors shadow-xs select-none min-w-[46px] ${
                    showSpeedMenu
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : theme === 'dark'
                        ? 'bg-slate-900/60 hover:bg-slate-800 text-slate-200 border-slate-700/60'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  }`}
                >
                  <span className="font-mono">{playbackSpeed}x</span>
                  <ChevronUp className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ${showSpeedMenu ? 'rotate-180' : ''}`} />
                </button>

                {showSpeedMenu && (
                  <div
                    className={`absolute bottom-full mb-1 right-0 w-full min-w-[46px] max-h-64 overflow-y-auto z-50 rounded shadow-xl border p-0.5 flex flex-col gap-0.5 animate-fadeIn ${
                      theme === 'dark' ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  >
                    {[0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => {
                          onPlaybackStateChange({ playbackSpeed: speed });
                          setShowSpeedMenu(false);
                        }}
                        className={`text-[9px] font-bold py-0.5 px-1.5 rounded-[3px] font-mono text-left transition-colors cursor-pointer w-full flex items-center justify-start ${
                          playbackSpeed === speed
                            ? 'bg-amber-500 text-slate-950'
                            : theme === 'dark'
                              ? 'hover:bg-slate-800 text-slate-300 hover:text-white'
                              : 'hover:bg-slate-100 text-slate-700 hover:text-slate-950'
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal for selecting subtitle track when multiple subtitle tracks are found */}
      {showTrackSelectModal && availableSubTracks.length > 0 && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowTrackSelectModal(false)}
        >
          <div 
            className={`rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 border ${
              theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
              <h3 className="text-base font-semibold flex items-center gap-2 text-amber-400">
                <Subtitles className="w-5 h-5 text-amber-400" />
                Выбар субцітраў
              </h3>
              <button
                onClick={() => setShowTrackSelectModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Знойдзена субцітраў <strong className="text-amber-400">{availableSubTracks.length}</strong> . Выберыце субцітры для выцягвання:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {availableSubTracks.map((tr, idx) => {
                const isSelected = selectedTrackIdx === idx;
                const isSupported = isSupportedSubtitleCodec(tr.codecId, tr.trackName);
                const langTag = tr.language ? `[${tr.language.toUpperCase()}]` : '';
                const nameTag = tr.trackName || `Дарожка #${tr.trackNumber}`;
                const codecTag = tr.codecId ? `(${tr.codecId})` : '';
                const isDownloadingThis = downloadingSubIdx === idx;

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedTrackIdx(idx)}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${
                      isSelected
                        ? theme === 'dark'
                          ? 'bg-amber-950/40 border-amber-500 text-amber-100 shadow-md ring-1 ring-amber-500/30'
                          : 'bg-amber-50 border-amber-500 text-amber-950 shadow-md ring-1 ring-amber-500/30'
                        : theme === 'dark'
                          ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                      <input
                        type="radio"
                        name="subTrack"
                        checked={isSelected}
                        onChange={() => setSelectedTrackIdx(idx)}
                        className="accent-amber-500 w-4 h-4 cursor-pointer shrink-0"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span
                          className={`font-medium flex items-center gap-1.5 flex-wrap min-w-0 ${
                            nameTag.length > 50
                              ? 'text-[8.5px] leading-tight break-all'
                              : nameTag.length > 30
                                ? 'text-[9.5px] leading-tight break-all'
                                : 'text-xs'
                          }`}
                          title={nameTag}
                        >
                          <span className="truncate max-w-full">{nameTag}</span>
                          {langTag && <span className="text-amber-400 font-bold shrink-0">{langTag}</span>}
                          {!isSupported && (
                            <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.2 rounded font-semibold shrink-0">
                              фармат не падтрымліваецца
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          {codecTag} • Нумар: {tr.trackNumber}
                        </span>
                      </div>
                    </div>

                    {!isSupported && (
                      <div className="flex items-center shrink-0 pl-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadRawSubTrack(tr, idx);
                          }}
                          disabled={isDownloadingThis}
                          className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center ${
                            theme === 'dark'
                              ? 'text-amber-400 hover:text-amber-200 hover:bg-amber-500/20 border border-amber-500/30'
                              : 'text-amber-700 hover:text-amber-950 hover:bg-amber-100 border border-amber-300'
                          } ${isDownloadingThis ? 'opacity-50 cursor-wait' : ''}`}
                          title="Спампаваць зыходную дарожку субцітраў з файла"
                        >
                          {isDownloadingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-1.5 pt-3 border-t border-slate-700/50">
              {(() => {
                const currentTrack = availableSubTracks[selectedTrackIdx];
                const isCurrentSupported = currentTrack ? isSupportedSubtitleCodec(currentTrack.codecId, currentTrack.trackName) : false;

                return (
                  <>
                    <button
                      onClick={() => {
                        if (!isCurrentSupported) return;
                        const chosen = availableSubTracks[selectedTrackIdx];
                        setShowTrackSelectModal(false);
                        if (chosen) {
                          executeExtraction(chosen.trackNumber, selectedTrackIdx, false);
                        }
                      }}
                      disabled={!isCurrentSupported}
                      title={isCurrentSupported ? "Выцягнуць субцітры ў арыгінал" : "Фармат субцітраў не падтрымліваецца (падтрымліваюцца толькі .srt і .ass)"}
                      className={`px-2.5 py-1 text-[11px] rounded-md font-semibold shadow-sm transition-all flex items-center gap-1 whitespace-nowrap ${
                        isCurrentSupported
                          ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                          : 'bg-slate-700/60 text-slate-400 cursor-not-allowed opacity-50 border border-slate-600/40'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      Выцягнуць у арыгінал
                    </button>
                    <button
                      onClick={() => {
                        if (!isCurrentSupported) return;
                        const chosen = availableSubTracks[selectedTrackIdx];
                        setShowTrackSelectModal(false);
                        if (chosen) {
                          executeExtraction(chosen.trackNumber, selectedTrackIdx, true);
                        }
                      }}
                      disabled={!isCurrentSupported}
                      title={isCurrentSupported ? "Выцягнуць субцітры ў пераклад" : "Фармат субцітраў не падтрымліваецца (падтрымліваюцца толькі .srt і .ass)"}
                      className={`px-2.5 py-1 text-[11px] rounded-md font-semibold shadow-sm transition-all flex items-center gap-1 whitespace-nowrap ${
                        isCurrentSupported
                          ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
                          : 'bg-slate-700/60 text-slate-400 cursor-not-allowed opacity-50 border border-slate-600/40'
                      }`}
                    >
                      <Languages className="w-3 h-3" />
                      Выцягнуць у пераклад
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal for selecting audio track when multiple audio tracks or external tracks are available */}
      {showAudioTrackSelectModal && (mediaFile || mediaFileName) && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowAudioTrackSelectModal(false)}
        >
          <div 
            className={`rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 border ${
              theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
              <h3 className="text-base font-semibold flex items-center gap-2 text-indigo-400">
                <Volume2 className="w-5 h-5 text-indigo-400" />
                Выбар аўдыядарожкі
              </h3>
              <button
                onClick={() => setShowAudioTrackSelectModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Даступна дарожак: <strong className="text-indigo-400">{modalTrackList.length}</strong>. Апрацоўка і падрыхтоўка аўдыя адбываецца аўтаматычна пры выбары дарожкі.
            </p>
            {mediaFileName && (
              <p className={`font-semibold truncate max-w-full ${
                mediaFileName.length > 55 ? 'text-[8px]' : mediaFileName.length > 35 ? 'text-[9px]' : 'text-[10px]'
              } ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`} title={mediaFileName}>
                Файл: {mediaFileName}
              </p>
            )}

            {/* Processing status block inside modal */}
            {audioProcessingStatus.isProcessing && (
              <div className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
                theme === 'dark'
                  ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}>
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-semibold truncate">
                      {audioProcessingStatus.message || "Ідзе апрацоўка аўдыя..."}
                    </span>
                    {audioProcessingStatus.progress !== null && audioProcessingStatus.progress >= 0 && (
                      <div className={`w-full h-1.5 rounded-full overflow-hidden mt-1.5 border ${
                        theme === 'dark' ? 'bg-slate-900/90 border-amber-500/30' : 'bg-amber-200/90 border-amber-400/80'
                      }`}>
                        <div
                          className={`h-full transition-all duration-200 ease-out ${
                            theme === 'dark' ? 'bg-amber-400' : 'bg-amber-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(3, audioProcessingStatus.progress))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelAudioProcessing}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                    theme === 'dark'
                      ? 'bg-red-500/20 hover:bg-red-600 text-red-300 hover:text-white border-red-500/40'
                      : 'bg-red-100 hover:bg-red-600 text-red-800 hover:text-white border-red-300'
                  }`}
                  title="Скасаваць апрацоўку"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Скасаваць
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {modalTrackList.map((tr) => {
                const isSelected = selectedTrackKey === tr.key;
                const isProcessedEmbedded = tr.type === 'embedded' && tr.isProcessed && tr.trackNumber && processedTracks[tr.trackNumber];
                const isExternalTrack = tr.type === 'external' && tr.extTrack;

                return (
                  <div
                    key={tr.key}
                    onClick={() => setSelectedTrackKey(tr.key)}
                    onDoubleClick={() => {
                      setShowAudioTrackSelectModal(false);
                      if (tr.type === 'external' && tr.extTrack) {
                        setActiveExternalTrackId(tr.extTrack.id);
                        setActiveTrackNumberAndRef(null);
                        setExtAudioFileName(tr.extTrack.label);
                        onExtAudioFileChange?.(tr.extTrack.file);
                        const extName = (tr.extTrack.originalName || '').toLowerCase();
                        const isUnsupportedExt = ['ac3', 'eac3', 'e-ac-3', 'dts', 'truehd', 'dtshd'].some(c => extName.includes(c));
                        setRequiresTranscode(isUnsupportedExt);
                        addToast?.(`Пераключана на знешнюю аўдыядарожку: ${tr.extTrack.originalName}`, 'info');
                      } else {
                        setActiveExternalTrackId(null);
                        executeAudioExtraction(tr.trackNumber, undefined, false);
                      }
                    }}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${
                      isSelected
                        ? theme === 'dark'
                          ? 'bg-indigo-950/40 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/30'
                          : 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-md ring-1 ring-indigo-500/30'
                        : theme === 'dark'
                          ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                      <input
                        type="radio"
                        name="audioTrackSelectModal"
                        checked={isSelected}
                        onChange={() => setSelectedTrackKey(tr.key)}
                        className="accent-indigo-500 w-4 h-4 cursor-pointer shrink-0"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`font-medium flex items-center gap-1.5 flex-wrap min-w-0 ${
                          tr.nameTag.length > 50
                            ? 'text-[8.5px] leading-tight break-all'
                            : tr.nameTag.length > 30
                              ? 'text-[9.5px] leading-tight break-all'
                              : 'text-xs'
                        }`} title={tr.nameTag}>
                          {tr.nameTag} {tr.langTag && <span className="text-indigo-400 font-bold">{tr.langTag}</span>}
                          {tr.isDefault && <span className="text-[10px] text-slate-400 font-normal border border-slate-700 px-1 rounded">(па змаўчанні)</span>}
                          {tr.type === 'external' && (
                            <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.2 rounded font-semibold">
                              Знешняя
                            </span>
                          )}
                          {tr.isActive && (
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.2 rounded font-semibold">
                              Актыўная
                            </span>
                          )}
                          {tr.isProcessed && tr.type === 'embedded' && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-1.5 py-0.2 rounded font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Апрацавана
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {tr.codecTag} {tr.channelsTag ? `• ${tr.channelsTag}` : ''} {tr.type === 'embedded' && tr.trackNumber ? `• Нумар: ${tr.trackNumber}` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons on the processed or external track row */}
                    {(isProcessedEmbedded || isExternalTrack) && (
                      <div className="flex items-center gap-1.5 shrink-0 pl-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isProcessedEmbedded && tr.trackNumber && processedTracks[tr.trackNumber]) {
                              downloadAudioFile(processedTracks[tr.trackNumber].audioFile, processedTracks[tr.trackNumber].label);
                            } else if (isExternalTrack && tr.extTrack) {
                              downloadAudioFile(tr.extTrack.file, tr.extTrack.originalName);
                            }
                          }}
                          className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center ${
                            theme === 'dark'
                              ? 'text-emerald-400 hover:text-emerald-200 hover:bg-emerald-500/20 border border-emerald-500/30'
                              : 'text-emerald-700 hover:text-emerald-950 hover:bg-emerald-200 border border-emerald-300'
                          }`}
                          title="Спампаваць атрыманы аўдыяфайл"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (tr.type === 'embedded' && tr.trackNumber) {
                              deleteProcessedTrack(tr.trackNumber);
                            } else if (tr.type === 'external' && tr.extTrack) {
                              deleteExternalTrack(tr.extTrack.id);
                            }
                          }}
                          className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center ${
                            theme === 'dark'
                              ? 'text-red-400 hover:text-red-300 hover:bg-red-500/20 border border-red-500/30'
                              : 'text-red-700 hover:text-red-900 hover:bg-red-200 border border-red-300'
                          }`}
                          title={tr.type === 'external' ? "Выдаліць знешнюю аўдыядарожку" : "Выдаліць апрацаванае аўдыя"}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Button to upload another audio track inside modal */}
            <div className="pt-2 border-t border-slate-700/50">
              <label className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed border-indigo-500/50 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-semibold text-xs cursor-pointer transition-all hover:border-indigo-400 select-none">
                <Music className="w-4 h-4 text-indigo-400 shrink-0" />
                загрузіць іншую аўдыядарожку
                <input
                  type="file"
                  accept="audio/*,.ac3,.eac3,.e-ac3,.m4a,.aac,.mp3,.wav,.ogg,.flac"
                  onChange={handleExtAudioUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-700/50">
              <button
                onClick={() => {
                  const chosen = modalTrackList.find(t => t.key === selectedTrackKey);
                  setShowAudioTrackSelectModal(false);
                  if (!chosen) return;

                  if (chosen.type === 'external' && chosen.extTrack) {
                    setActiveExternalTrackId(chosen.extTrack.id);
                    setActiveTrackNumberAndRef(null);
                    setExtAudioFileName(chosen.extTrack.label);
                    onExtAudioFileChange?.(chosen.extTrack.file);
                    const extName = (chosen.extTrack.originalName || '').toLowerCase();
                    const isUnsupportedExt = ['ac3', 'eac3', 'e-ac-3', 'dts', 'truehd', 'dtshd'].some(c => extName.includes(c));
                    setRequiresTranscode(isUnsupportedExt);
                    addToast?.(`Пераключана на знешнюю аўдыядарожку: ${chosen.extTrack.originalName}`, 'info');
                  } else {
                    setActiveExternalTrackId(null);
                    executeAudioExtraction(chosen.trackNumber, undefined, false);
                  }
                }}
                className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Выбраць дарожку
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(TimelinePlayerComponent, (prev, next) => {
  if (
    prev.theme !== next.theme ||
    prev.showActorsOnPlayer !== next.showActorsOnPlayer ||
    prev.mediaFile !== next.mediaFile ||
    prev.mediaFileName !== next.mediaFileName ||
    prev.extAudioFile !== next.extAudioFile ||
    prev.mediaLoadingProgress !== next.mediaLoadingProgress ||
    prev.isTranscribing !== next.isTranscribing ||
    prev.hasAutoSubtitles !== next.hasAutoSubtitles ||
    prev.activeTrackNumber !== next.activeTrackNumber ||
    prev.activeExternalTrackId !== next.activeExternalTrackId ||
    prev.processedTracks !== next.processedTracks ||
    prev.activeSubtitleIndex !== next.activeSubtitleIndex ||
    prev.subtitles.length !== next.subtitles.length
  ) {
    return false;
  }

  if (
    prev.playbackState.currentTime !== next.playbackState.currentTime ||
    prev.playbackState.isPlaying !== next.playbackState.isPlaying ||
    prev.playbackState.playbackSpeed !== next.playbackState.playbackSpeed ||
    prev.playbackState.isSubtitlesOnlyPlay !== next.playbackState.isSubtitlesOnlyPlay
  ) {
    return false;
  }

  // Check if current active subtitle entry changed
  const prevActive = prev.subtitles[prev.activeSubtitleIndex];
  const nextActive = next.subtitles[next.activeSubtitleIndex];
  if (prevActive !== nextActive) {
    if (
      !prevActive || !nextActive ||
      prevActive.id !== nextActive.id ||
      prevActive.text !== nextActive.text ||
      prevActive.translatedText !== nextActive.translatedText ||
      prevActive.startTime !== nextActive.startTime ||
      prevActive.endTime !== nextActive.endTime ||
      prevActive.actor !== nextActive.actor
    ) {
      return false;
    }
  }

  return true;
});
