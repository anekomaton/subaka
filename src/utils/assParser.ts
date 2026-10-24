/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import { SubtitleEntry } from '../types';
import { parseSrt, secondsToSrtTime, srtTimeToSeconds } from './subtitleUtils';

/**
 * Converts ASS time (H:MM:SS.cs or HH:MM:SS.cs) to total seconds.
 */
export function assTimeToSeconds(assTime: string): number {
  if (!assTime) return 0;
  const clean = assTime.trim();
  const parts = clean.split(':');
  if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    return isNaN(s) ? 0 : Math.max(0, s);
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return Math.max(0, mins * 60 + secs);
  }
  const hours = parseFloat(parts[0]) || 0;
  const minutes = parseFloat(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

/**
 * Converts total seconds into ASS time format: H:MM:SS.cs
 */
export function secondsToAssTime(secondsNum: number): string {
  if (isNaN(secondsNum) || secondsNum < 0) secondsNum = 0;
  const hours = Math.floor(secondsNum / 3600);
  const remainingSecs = secondsNum % 3600;
  const mins = Math.floor(remainingSecs / 60);
  const secsTotal = remainingSecs % 60;
  const secs = Math.floor(secsTotal);
  const cs = Math.round((secsTotal - secs) * 100);

  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const csClamped = cs >= 100 ? 99 : cs;

  return `${hours}:${pad2(mins)}:${pad2(secs)}.${pad2(csClamped)}`;
}

/**
 * Converts SRT time string (HH:MM:SS,mmm) to ASS time string (H:MM:SS.cs)
 */
export function srtTimeToAssTime(srtTime: string): string {
  const seconds = srtTimeToSeconds(srtTime);
  return secondsToAssTime(seconds);
}

/**
 * Result of parsing an ASS file
 */
export interface ParsedAssResult {
  entries: SubtitleEntry[];
  rawHeader?: string; // Content before the events dialogue lines to preserve styling
}

/**
 * Parses ASS text into SubtitleEntry array and captures the header.
 */
export function parseAss(assContent: string): ParsedAssResult {
  const entries: SubtitleEntry[] = [];
  if (!assContent || !assContent.trim()) {
    return { entries: [] };
  }

  const lines = assContent.replace(/\r\n/g, '\n').split('\n');

  let eventsSectionStarted = false;
  let formatColumns: string[] = [];
  const headerLines: string[] = [];

  let startColIdx = 1;
  let endColIdx = 2;
  let nameColIdx = 4;
  let textColIdx = 9;

  let entryIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    if (!eventsSectionStarted) {
      if (trimmedLine.toLowerCase() === '[events]') {
        eventsSectionStarted = true;
        headerLines.push(rawLine);
      } else {
        headerLines.push(rawLine);
      }
      continue;
    }

    // Inside [Events]
    if (trimmedLine.startsWith('Format:')) {
      headerLines.push(rawLine);
      const cols = trimmedLine
        .substring(7)
        .split(',')
        .map((c) => c.trim().toLowerCase());
      formatColumns = cols;

      const foundStart = cols.indexOf('start');
      if (foundStart !== -1) startColIdx = foundStart;

      const foundEnd = cols.indexOf('end');
      if (foundEnd !== -1) endColIdx = foundEnd;

      const foundName = cols.indexOf('name');
      const foundActor = cols.indexOf('actor');
      if (foundName !== -1) nameColIdx = foundName;
      else if (foundActor !== -1) nameColIdx = foundActor;

      const foundText = cols.indexOf('text');
      if (foundText !== -1) textColIdx = foundText;
      continue;
    }

    // Check for Dialogue line
    const isDialogue = /^Dialogue:/i.test(trimmedLine);
    if (!isDialogue) {
      // Header or other comment / style in events
      if (entries.length === 0) {
        headerLines.push(rawLine);
      }
      continue;
    }

    // Parse dialogue fields
    // Standard format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const prefixMatch = trimmedLine.match(/^Dialogue:\s*/i);
    if (!prefixMatch) continue;

    const content = trimmedLine.substring(prefixMatch[0].length);

    const totalCols = Math.max(textColIdx + 1, formatColumns.length || 10);
    const parts: string[] = [];
    let curIndex = 0;
    for (let col = 0; col < totalCols - 1; col++) {
      const nextComma = content.indexOf(',', curIndex);
      if (nextComma === -1) break;
      parts.push(content.substring(curIndex, nextComma));
      curIndex = nextComma + 1;
    }
    parts.push(content.substring(curIndex)); // Last part contains the entire text

    const startRaw = parts[startColIdx]?.trim() || '0:00:00.00';
    const endRaw = parts[endColIdx]?.trim() || '0:00:02.00';
    const actorRaw = parts[nameColIdx]?.trim() || '';
    const textRaw = parts[textColIdx] !== undefined ? parts[textColIdx] : parts[parts.length - 1] || '';

    // Convert ASS text to normalized text:
    // 1. \N or \n to newline
    let cleanedText = textRaw.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');

    // 2. Convert standard inline formatting tags
    cleanedText = cleanedText
      .replace(/\{\\b1\}/gi, '<b>')
      .replace(/\{\\b0\}/gi, '</b>')
      .replace(/\{\\i1\}/gi, '<i>')
      .replace(/\{\\i0\}/gi, '</i>')
      .replace(/\{\\u1\}/gi, '<u>')
      .replace(/\{\\u0\}/gi, '</u>')
      // Strip other ASS override tags like {\fn...}, {\fs...}, {\c&H...}, {\pos(...)}
      .replace(/\{[^}]*\}/g, '')
      .trim();

    const startSec = assTimeToSeconds(startRaw);
    const endSec = assTimeToSeconds(endRaw);

    const startTime = secondsToSrtTime(startSec);
    const endTime = secondsToSrtTime(endSec > startSec ? endSec : startSec + 1.5);

    entries.push({
      id: `sub-${entryIndex}-${Math.random().toString(36).substring(2, 7)}`,
      startTime,
      endTime,
      originalStartTime: startTime,
      originalEndTime: endTime,
      text: cleanedText || '',
      actor: actorRaw || undefined,
      originalActor: actorRaw || undefined,
    });

    entryIndex++;
  }

  const rawHeader = headerLines.length > 0 ? headerLines.join('\n') : undefined;

  return { entries, rawHeader };
}

/**
 * Standard default ASS header if none was loaded
 */
export const DEFAULT_ASS_HEADER = `[Script Info]
; Script generated by Belarusian Subtitle Studio
Title: Belarusian Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,46,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

/**
 * Converts SubtitleEntry array into ASS (.ass) format string.
 * Uses translated text if useTranslation is true.
 * Places entry.actor into the Name field.
 */
export function stringifyAss(
  entries: SubtitleEntry[],
  useTranslation: boolean = false,
  rawHeader?: string
): string {
  let header = rawHeader && rawHeader.includes('[Events]') ? rawHeader.trim() : DEFAULT_ASS_HEADER;

  // Make sure header ends with Format line under [Events]
  if (!header.includes('[Events]')) {
    header += `\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  } else if (!/Format:\s*Layer/i.test(header)) {
    header += `\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  }

  const dialogueLines = entries.map((entry) => {
    const startAss = srtTimeToAssTime(entry.startTime);
    const endAss = srtTimeToAssTime(entry.endTime);

    // Replace commas with semicolons to keep ASS fields strictly aligned without breaking columns
    const actorToUse = useTranslation ? (entry.actor || '') : (entry.originalActor || entry.actor || '');
    const actorName = actorToUse
      .replace(/,/g, ';')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    const rawText = useTranslation ? (entry.translatedText ?? '') : entry.text;

    // Convert newlines to \N and convert standard HTML tags to ASS tags if any
    let assText = (rawText || '')
      .replace(/\r?\n/g, '\\N')
      .replace(/<b>/gi, '{\\b1}')
      .replace(/<\/b>/gi, '{\\b0}')
      .replace(/<i>/gi, '{\\i1}')
      .replace(/<\/i>/gi, '{\\i0}')
      .replace(/<u>/gi, '{\\u1}')
      .replace(/<\/u>/gi, '{\\u0}');

    return `Dialogue: 0,${startAss},${endAss},Default,${actorName},0,0,0,,${assText}`;
  });

  return `${header}\n${dialogueLines.join('\n')}\n`;
}

/**
 * Auto-detects whether content is ASS, SRT, or VTT and parses it appropriately.
 */
export function parseSubtitleContent(
  content: string,
  fileName?: string
): { entries: SubtitleEntry[]; format: 'ass' | 'srt'; rawHeader?: string } {
  const isAss =
    (fileName && fileName.toLowerCase().endsWith('.ass')) ||
    content.includes('[Script Info]') ||
    content.includes('[Events]') ||
    /Dialogue:\s*\d+/i.test(content);

  if (isAss) {
    const { entries, rawHeader } = parseAss(content);
    return { entries, format: 'ass', rawHeader };
  }

  const entries = parseSrt(content);
  return { entries, format: 'srt' };
}
