// Web storage: autosave slot, best-score table, and file export/import.
// Everything is plain JSON in localStorage; a run can also be written out to a
// .gridling file and read back on another machine.

import { serialize, deserialize, SAVE_VERSION } from './sim/engine.js';

const AUTOSAVE_KEY = 'gridling:autosave';
const SCORES_KEY = 'gridling:scores';
const SEEN_KEY = 'gridling:coach';

export function storageAvailable() {
  try {
    const k = '__gridling_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function saveGame(game) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), data: serialize(game) }));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return deserialize(rec.data);
  } catch (e) {
    console.warn('Autosave unreadable:', e.message);
    return null;
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}

export function saveMeta() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    const d = JSON.parse(rec.data);
    return {
      at: rec.at,
      version: d.version,
      tick: d.tick,
      score: Math.round(d.score || 0),
      money: Math.round(d.money || 0),
      plants: (d.plants || []).length,
      cities: (d.cities || []).length,
    };
  } catch {
    return null;
  }
}

export function exportFile(game, name = 'gridling-save') {
  const payload = { app: 'gridling', version: SAVE_VERSION, kind: 'save', data: JSON.parse(serialize(game)) };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.gridling`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function importFileFromText(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.app !== 'gridling' || obj.kind !== 'save')
    throw new Error('That file is not a Gridling save.');
  return deserialize(obj.data);
}

// ---- best scores -------------------------------------------------------------

export function listScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addScore(entry) {
  const list = listScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 10);
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(top)); } catch { /* ignore */ }
  return { list: top, rank: top.findIndex((e) => e.id === entry.id) + 1 };
}

// ---- coach-mark memory -------------------------------------------------------

export function seenCoach(id) {
  try { return !!localStorage.getItem(`${SEEN_KEY}:${id}`); } catch { return false; }
}
export function markCoach(id) {
  try { localStorage.setItem(`${SEEN_KEY}:${id}`, '1'); } catch { /* ignore */ }
}
