/*
 * Plays a fight's sound from the playback clock: random music and random effects,
 * silent while paused, when the tab is hidden, and after leaving the page.
 * The audio starts from the Play click, because browsers block sound before one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cuesBetween, musicPlaysDuring, pickOther } from "./soundCues.js";
import { SFX, SONGS, SOUND_GROUPS, playStep } from "./sounds.js";

const MUTE_KEY = "arena-sound-muted";
const MASTER = 0.44;
const MUSIC = 0.45; // under the effects, so hits stand out
const LOOKAHEAD = 0.15;
const SONG_IDS = Object.keys(SONGS);

let ctx = null;
let master = null;
let muted = false;
let bus = null; // the music's own gain, so stopping cuts its tail cleanly
let timer = null;
let songId = null;
let step = 0;
const lastSound = {};

function audio() {
  if (!ctx) {
    const Ctx = typeof window === "undefined" ? null : window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
  }
  if (ctx.state !== "running" && !document.hidden) ctx.resume().catch(() => {});
  return ctx;
}

function playSound(group) {
  if (!audio()) return;
  const id = pickOther(SOUND_GROUPS[group], lastSound[group]);
  lastSound[group] = id;
  SFX[id](ctx, master, ctx.currentTime + 0.01);
}

function stopMusic() {
  clearInterval(timer);
  timer = null;
  if (!bus) return;
  const old = bus;
  bus = null;
  old.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
  setTimeout(() => old.disconnect(), 200);
}

function startMusic() {
  if (timer || !audio()) return;
  if (!songId) songId = pickOther(SONG_IDS, null);
  const song = SONGS[songId];
  const stepDur = 60 / song.bpm / 4;
  bus = ctx.createGain();
  bus.gain.value = MUSIC;
  bus.connect(master);
  let next = ctx.currentTime + 0.05;
  const pump = () => {
    // After a stall, carry on from now instead of rushing through the missed notes.
    if (next < ctx.currentTime) next = ctx.currentTime + 0.02;
    while (next < ctx.currentTime + LOOKAHEAD) {
      playStep(ctx, bus, song, step, next);
      step += 1;
      next += stepDur;
    }
  };
  pump();
  timer = setInterval(pump, 30);
}

function changeSong() {
  const wasPlaying = !!timer;
  stopMusic();
  songId = pickOther(SONG_IDS, songId);
  step = 0;
  if (wasPlaying) startMusic();
}

function applyMuted(value) {
  muted = value;
  if (master) master.gain.value = value ? 0 : MASTER;
}

function savedMute() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useFightSound(events, pb) {
  const [isMuted, setIsMuted] = useState(savedMute);
  const lastPos = useRef({ index: pb.index, ms: pb.ms });
  const musicOn = pb.playing && musicPlaysDuring(pb.event);

  useEffect(() => applyMuted(isMuted), [isMuted]);

  useEffect(() => {
    const from = lastPos.current;
    const to = { index: pb.index, ms: pb.ms };
    lastPos.current = to;
    if (!pb.playing) return;
    for (const cue of cuesBetween(events, from, to)) {
      if (cue.newSong) changeSong();
      playSound(cue.sound);
    }
  }, [events, pb.index, pb.ms, pb.playing]);

  useEffect(() => {
    if (musicOn) startMusic();
    else stopMusic();
    return stopMusic;
  }, [musicOn]);

  // The fight's clock stops in a hidden tab, so the sound stops with it.
  useEffect(() => {
    const onVisibility = () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const toggle = pb.toggle;
  const togglePlay = useCallback(() => {
    audio(); // inside the click, which is what lets the browser start sound
    toggle();
  }, [toggle]);

  const toggleMute = useCallback(() => {
    setIsMuted((value) => {
      try {
        localStorage.setItem(MUTE_KEY, value ? "0" : "1");
      } catch {
        // The choice just won't be remembered next visit.
      }
      return !value;
    });
  }, []);

  return { muted: isMuted, toggleMute, togglePlay };
}
