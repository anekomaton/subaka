import React, { useState, useEffect } from 'react';
import {
  Volume2,
  X,
  Music,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { probeMkvAudioCodec, AudioTrackInfo } from '../utils/mkvAudioExtractor';
import { isTauriDesktop, getWhisperEngineDetails, WhisperEngineDetails } from '../utils/tauriBridge';

interface SubtitleTrackSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaFile: File | null;
  mediaFileName: string;
  extAudioFile: File | null;
  activeTrackNumber: number | null;
  activeExternalTrackId: string | null;
  processedForGenTracks: Record<number, { blob: Blob; audioFile: File; label: string }>;
  processedTracks: Record<number, { blob: Blob; audioFile: File; label: string }>;
  onStartTranscribe: (
    engineChoice: string,
    modelChoice: string,
    targetTrackNum: number,
    isExternalTrack: boolean,
    customAudioFile?: File
  ) => void;
  theme: 'dark' | 'light';
}

export default function SubtitleTrackSelectModal({
  isOpen,
  onClose,
  mediaFile,
  mediaFileName,
  extAudioFile,
  activeTrackNumber,
  activeExternalTrackId,
  processedForGenTracks,
  processedTracks,
  onStartTranscribe,
  theme,
}: SubtitleTrackSelectModalProps) {
  const [probedTracks, setProbedTracks] = useState<AudioTrackInfo[]>([]);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [selectedTrackKey, setSelectedTrackKey] = useState<string>('embedded_1');
  const [customGenAudioFile, setCustomGenAudioFile] = useState<File | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isTauriDesktop());
  const [engineChoice, setEngineChoice] = useState<'whisper' | 'gemini'>(() => isTauriDesktop() ? 'whisper' : 'gemini');
  const [whisperDetails, setWhisperDetails] = useState<WhisperEngineDetails | null>(null);
  const modelChoice = 'auto';

  useEffect(() => {
    if (isDesktop && isOpen) {
      getWhisperEngineDetails().then((details) => {
        if (details) setWhisperDetails(details);
      });
    }
  }, [isDesktop, isOpen]);

  // Determine if extAudioFile is an internal transcoded track from mediaFile or a genuine user-uploaded external track
  const isTranscodedTrack = (file: File | null) => {
    if (!file) return false;
    if ((file as any).isTranscodedTrack) return true;
    if (mediaFile && !activeExternalTrackId) return true;
    if (/_audio\d+\.(m4a|mp3|wav|aac|ogg|opus)$/i.test(file.name)) return true;
    if (/_subtitles_track\d*\.(m4a|mp3|wav|aac|ogg|opus)$/i.test(file.name)) return true;
    if (processedTracks && Object.values(processedTracks).some(p => p.audioFile === file || p.audioFile?.name === file.name)) return true;
    if (processedForGenTracks && Object.values(processedForGenTracks).some(p => p.audioFile === file || p.audioFile?.name === file.name)) return true;
    return false;
  };

  const isGenuineExternalTrack = Boolean(extAudioFile && !isTranscodedTrack(extAudioFile) && (!mediaFile || activeExternalTrackId));

  // Probe media file tracks when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (!mediaFile) {
      if (isGenuineExternalTrack && extAudioFile) {
        setSelectedTrackKey('ext_active');
      }
      return;
    }

    let isMounted = true;
    setIsProbing(true);

    probeMkvAudioCodec(mediaFile)
      .then((probe) => {
        if (!isMounted) return;
        if (probe && probe.tracks && probe.tracks.length > 0) {
          setProbedTracks(probe.tracks);
        } else {
          setProbedTracks([{ trackNumber: 1, codecId: 'AAC', codecName: 'Аўдыя', channels: 2 }]);
        }
      })
      .catch((err) => {
        console.warn('[SubtitleTrackSelectModal] Probe error:', err);
        if (isMounted) setProbedTracks([{ trackNumber: 1, codecId: 'AAC', codecName: 'Аўдыя', channels: 2 }]);
      })
      .finally(() => {
        if (isMounted) setIsProbing(false);
      });

    // Default track key selection (prefer genuine active external track or active embedded track or track 1)
    if (isGenuineExternalTrack && activeExternalTrackId) {
      setSelectedTrackKey('ext_active');
    } else if (activeTrackNumber) {
      setSelectedTrackKey(`embedded_${activeTrackNumber}`);
    } else {
      setSelectedTrackKey('embedded_1');
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, mediaFile, extAudioFile, activeTrackNumber, activeExternalTrackId, isGenuineExternalTrack]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const embeddedTracksList = probedTracks.length > 0 ? probedTracks : [{ trackNumber: 1, codecId: 'AAC', codecName: 'Аўдыя', channels: 2 }];
  const totalAvailableTracks = embeddedTracksList.length + (isGenuineExternalTrack ? 1 : 0) + (customGenAudioFile ? 1 : 0);

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomGenAudioFile(file);
      setSelectedTrackKey('custom_gen');
    }
  };

  const handleConfirm = () => {
    if (selectedTrackKey === 'custom_gen' && customGenAudioFile) {
      onStartTranscribe(engineChoice, modelChoice, 1, true, customGenAudioFile);
    } else if (selectedTrackKey === 'ext_active' && isGenuineExternalTrack && extAudioFile) {
      onStartTranscribe(engineChoice, modelChoice, 1, true, extAudioFile);
    } else if (selectedTrackKey.startsWith('embedded_')) {
      const trackNum = parseInt(selectedTrackKey.split('_')[1], 10) || 1;
      onStartTranscribe(engineChoice, modelChoice, trackNum, false, undefined);
    } else {
      onStartTranscribe(engineChoice, modelChoice, 1, false, undefined);
    }
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div 
        className={`rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 border ${
          theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header matching TimelinePlayer track select modal */}
        <div className={`flex items-center justify-between pb-3 border-b ${
          theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200'
        }`}>
          <h3 className={`text-base font-semibold flex items-center gap-2 ${
            theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
          }`}>
            <Volume2 className={`w-5 h-5 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`} />
            Выбар аўдыядарожкі для генерацыі субцітраў
          </h3>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg transition-colors cursor-pointer ${
              theme === 'dark'
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine Selection (Whisper / Gemini) - Only visible in desktop version */}
        {isDesktop && (
          <div className="space-y-1.5">
            <label className={`text-xs font-semibold block ${
              theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
            }`}>
              Рухавік генерацыі:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label
                onClick={() => setEngineChoice('whisper')}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                  engineChoice === 'whisper'
                    ? theme === 'dark'
                      ? 'bg-indigo-950/60 border-indigo-500 text-indigo-100 ring-1 ring-indigo-500/30'
                      : 'bg-indigo-50 border-indigo-500 text-indigo-950 ring-1 ring-indigo-500/30'
                    : theme === 'dark'
                      ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="engineChoice"
                    checked={engineChoice === 'whisper'}
                    onChange={() => setEngineChoice('whisper')}
                    className="accent-indigo-500 w-3.5 h-3.5 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold">Whisper</span>
                    <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>лакальна</span>
                  </div>
                </div>
                <span className={`text-[9px] border px-1.5 py-0.5 rounded font-mono font-bold ${
                  whisperDetails?.isCuda
                    ? theme === 'dark'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : theme === 'dark'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}>
                  {whisperDetails?.isCuda ? 'GPU' : 'CPU'}
                </span>
              </label>

              <label
                onClick={() => setEngineChoice('gemini')}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                  engineChoice === 'gemini'
                    ? theme === 'dark'
                      ? 'bg-indigo-950/60 border-indigo-500 text-indigo-100 ring-1 ring-indigo-500/30'
                      : 'bg-indigo-50 border-indigo-500 text-indigo-950 ring-1 ring-indigo-500/30'
                    : theme === 'dark'
                      ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="engineChoice"
                    checked={engineChoice === 'gemini'}
                    onChange={() => setEngineChoice('gemini')}
                    className="accent-indigo-500 w-3.5 h-3.5 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold">Gemini</span>
                    <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>анлайн</span>
                  </div>
                </div>
                <span className={`text-[9px] border px-1.5 py-0.5 rounded font-mono font-bold ${
                  theme === 'dark'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                    : 'bg-purple-100 text-purple-800 border-purple-300'
                }`}>
                  Auto
                </span>
              </label>
            </div>
          </div>
        )}

        <p className={`text-xs ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
          Даступна дарожак: <strong className={theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}>{totalAvailableTracks}</strong>. Выберыце аўдыядарожку з медыяфайла для генерацыі субцітраў.
        </p>
        {mediaFileName && (
          <p className={`font-semibold truncate max-w-full ${
            mediaFileName.length > 55 ? 'text-[8px]' : mediaFileName.length > 35 ? 'text-[9px]' : 'text-[10px]'
          } ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`} title={mediaFileName}>
            Файл: {mediaFileName}
          </p>
        )}

        {isProbing && (
          <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs animate-pulse ${
            theme === 'dark'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <RefreshCw className={`w-3.5 h-3.5 animate-spin ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`} />
            Аналіз дарожак медыяфайла...
          </div>
        )}

        {/* Tracks List */}
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {/* Active external audio track ONLY if genuine user-uploaded audio file */}
          {isGenuineExternalTrack && extAudioFile && (
            <div
              onClick={() => setSelectedTrackKey('ext_active')}
              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${
                selectedTrackKey === 'ext_active'
                  ? theme === 'dark'
                    ? 'bg-purple-950/40 border-purple-500 text-purple-100 shadow-md ring-1 ring-purple-500/30'
                    : 'bg-purple-50 border-purple-500 text-purple-950 shadow-md ring-1 ring-purple-500/30'
                  : theme === 'dark'
                    ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                <input
                  type="radio"
                  name="subtitleTrackSelectModal"
                  checked={selectedTrackKey === 'ext_active'}
                  onChange={() => setSelectedTrackKey('ext_active')}
                  className="accent-purple-500 w-4 h-4 cursor-pointer shrink-0"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-xs flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="truncate max-w-[200px]" title={extAudioFile.name}>{extAudioFile.name}</span>
                    <span className={`text-[10px] border px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                      theme === 'dark'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                        : 'bg-purple-100 text-purple-800 border-purple-300'
                    }`}>
                      Актыўная дарожка з плэера
                    </span>
                  </span>
                  <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                    {(extAudioFile.size / 1024 / 1024).toFixed(1)} MB • Знешні аўдыяфайл
                  </span>
                </div>
              </div>
            </div>
          )}


          {embeddedTracksList.map((tr) => {
            const key = `embedded_${tr.trackNumber}`;
            const isSelected = selectedTrackKey === key;
            const isDefault = tr.trackNumber === 1;
            const codecDisplay = tr.codecName || tr.codecId || (tr as any).codec || 'АЎДЫЯ';

            return (
              <div
                key={key}
                onClick={() => setSelectedTrackKey(key)}
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
                    name="subtitleTrackSelectModal"
                    checked={isSelected}
                    onChange={() => setSelectedTrackKey(key)}
                    className="accent-indigo-500 w-4 h-4 cursor-pointer shrink-0"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium text-xs flex items-center gap-1.5 flex-wrap">
                      Дарожка #{tr.trackNumber}
                      {tr.language && (
                        <span className={`${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} font-bold uppercase`}>
                          {tr.language}
                        </span>
                      )}
                      {tr.trackName && (
                        <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} font-normal`}>
                          ({tr.trackName})
                        </span>
                      )}
                      {isDefault && (
                        <span className={`text-[10px] font-normal border px-1 rounded ${
                          theme === 'dark' ? 'text-slate-400 border-slate-700' : 'text-slate-500 border-slate-300'
                        }`}>
                          (па змаўчанні)
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                      {codecDisplay} {tr.channels ? `• ${tr.channels} кан.` : ''} • Нумар: {tr.trackNumber}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Custom uploaded audio track if user selected one via button */}
          {customGenAudioFile && (
            <div
              onClick={() => setSelectedTrackKey('custom_gen')}
              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${
                selectedTrackKey === 'custom_gen'
                  ? theme === 'dark'
                    ? 'bg-purple-950/40 border-purple-500 text-purple-100 shadow-md ring-1 ring-purple-500/30'
                    : 'bg-purple-50 border-purple-500 text-purple-950 shadow-md ring-1 ring-purple-500/30'
                  : theme === 'dark'
                    ? 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                <input
                  type="radio"
                  name="subtitleTrackSelectModal"
                  checked={selectedTrackKey === 'custom_gen'}
                  onChange={() => setSelectedTrackKey('custom_gen')}
                  className="accent-purple-500 w-4 h-4 cursor-pointer shrink-0"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`font-medium flex items-center gap-1.5 flex-wrap min-w-0 ${
                    customGenAudioFile.name.length > 50
                      ? 'text-[8.5px] leading-tight break-all'
                      : customGenAudioFile.name.length > 30
                        ? 'text-[9.5px] leading-tight break-all'
                        : 'text-xs'
                  }`} title={customGenAudioFile.name}>
                    {customGenAudioFile.name}
                    <span className={`text-[10px] border px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                      theme === 'dark'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                        : 'bg-purple-100 text-purple-800 border-purple-300'
                    }`}>
                      Загружаны файл
                    </span>
                  </span>
                  <span className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                    {(customGenAudioFile.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Button to upload another audio track inside modal */}
        <div className={`pt-2 border-t ${theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <label className={`w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed text-xs font-semibold cursor-pointer transition-all select-none ${
            theme === 'dark'
              ? 'border-indigo-500/50 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:border-indigo-400'
              : 'border-indigo-300 bg-indigo-50/70 hover:bg-indigo-100/70 text-indigo-700 hover:border-indigo-400'
          }`}>
            <Music className={`w-4 h-4 shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`} />
            загрузіць іншую аўдыядарожку
            <input
              type="file"
              accept="audio/*,.ac3,.eac3,.e-ac3,.m4a,.aac,.mp3,.wav,.ogg,.flac"
              onChange={handleCustomFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Modal Actions */}
        <div className={`flex items-center justify-end gap-2.5 pt-2 border-t ${theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <button
            onClick={handleConfirm}
            className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Пачаць генерацыю субцітраў
          </button>
        </div>
      </div>
    </div>
  );
}
