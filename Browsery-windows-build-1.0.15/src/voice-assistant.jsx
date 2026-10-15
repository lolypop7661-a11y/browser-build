import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSpringPresence } from './motion.js';

const VOICE_SESSION_KEY = 'browsery:groq-voice-session-v1';
const VOICE_SPEAK_KEY = 'browsery:groq-voice-speak-v1';

function savedBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function recognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function statusMessage(status) {
  const messages = {
    'missing-key': 'Add your Groq API key in Settings → AI Overview before asking Groq.',
    'key-unreadable': 'The saved Groq key could not be read. Replace it in Settings → AI Overview.',
    'secure-storage-unavailable': 'Secure key storage is unavailable on this device.',
    'invalid-key': 'Groq rejected the saved API key. Check it in Settings → AI Overview.',
    'usage-limit': 'Groq’s usage limit was reached. Try again later.',
    'request-failed': 'Groq could not answer right now. Check your connection and try again.',
    timeout: 'Groq took too long to answer. Try again.',
    unsupported: 'Voice recognition is not available in this version of Browsery. You can still type a question.',
    'permission-denied': 'Microphone permission was denied. Enable it in Browsery’s site permissions, then try again.',
    'desktop-only': 'Groq voice is available in the Browsery desktop app.',
    'invalid-prompt': 'Say or type a short question, then try again.',
    empty: 'Groq returned an empty answer. Please try again.',
  };
  return messages[status] || 'Something interrupted the assistant. Please try again.';
}

// Tappable starters that show what Hey Groq knows about Browsery itself.
const EXAMPLE_QUESTIONS = [
  'Where is the search bar?',
  'Make Browsery use less RAM',
  'What extensions do I have?',
  'How do I reopen a closed tab?',
];

function cleanTranscript(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 600);
}

export function VoiceAssistantDrawer({ open, onClose, model, getContext, Icon, Button, CloseButton }) {
  const panelRef = useSpringPresence(open, { preset: 'fluid', offset: 90 });
  const recognitionRef = useRef(null);
  const restartTimer = useRef(0);
  const voiceSessionRef = useRef(false);
  const speakRef = useRef(true);
  const busyRef = useRef(false);
  const awaitingWakeCommand = useRef(false);
  const requestRef = useRef(0);
  // Read through a ref so recognition callbacks always get fresh state without restarting.
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  const [voiceSession, setVoiceSession] = useState(() => savedBoolean(VOICE_SESSION_KEY, false));
  const [speakAnswers, setSpeakAnswers] = useState(() => savedBoolean(VOICE_SPEAK_KEY, true));
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('idle');

  useEffect(() => { voiceSessionRef.current = voiceSession; try { localStorage.setItem(VOICE_SESSION_KEY, voiceSession ? '1' : '0'); } catch {} }, [voiceSession]);
  useEffect(() => { speakRef.current = speakAnswers; try { localStorage.setItem(VOICE_SPEAK_KEY, speakAnswers ? '1' : '0'); } catch {} }, [speakAnswers]);

  const stopRecognition = useCallback(({ stopVoiceSession = false } = {}) => {
    clearTimeout(restartTimer.current);
    awaitingWakeCommand.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch {}
    }
    setListening(false);
    if (stopVoiceSession) setVoiceSession(false);
  }, []);

  const speak = useCallback(text => {
    if (!speakRef.current || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 900));
      utterance.rate = 1.02;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }, []);

  const askGroq = useCallback(async question => {
    const prompt = cleanTranscript(question);
    if (!prompt || busyRef.current) return;
    const desktop = window.browseryDesktop;
    if (!desktop?.isDesktop || !desktop.askGroqVoice) {
      setStatus('desktop-only');
      return;
    }
    const run = ++requestRef.current;
    busyRef.current = true;
    setTranscript(prompt);
    setDraft(prompt);
    setAnswer('');
    setStatus('thinking');
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch {} }
    // A small, renderer-built summary of Browsery's state (no full URLs,
    // cookies, passwords or history). The main process re-validates it.
    let context;
    try { context = typeof getContextRef.current === 'function' ? getContextRef.current() : undefined; } catch { context = undefined; }
    try {
      const result = await desktop.askGroqVoice({ prompt, model, context });
      if (run !== requestRef.current) return;
      if (result?.status === 'ready' && result.text) {
        setAnswer(result.text);
        setStatus('ready');
        speak(result.text);
      } else {
        setStatus(result?.status || 'request-failed');
      }
    } catch {
      if (run === requestRef.current) setStatus('request-failed');
    } finally {
      if (run === requestRef.current) busyRef.current = false;
    }
  }, [model, speak]);

  const startRecognition = useCallback(() => {
    if (busyRef.current || recognitionRef.current || !voiceSessionRef.current) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) { setStatus('unsupported'); setVoiceSession(false); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = '';
    recognition.onstart = () => { setListening(true); setStatus('listening'); };
    recognition.onresult = event => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const phrase = cleanTranscript(event.results[index]?.[0]?.transcript || '');
        if (event.results[index].isFinal) finalText = cleanTranscript(`${finalText} ${phrase}`);
        else interim = cleanTranscript(`${interim} ${phrase}`);
      }
      const live = cleanTranscript(`${finalText} ${interim}`);
      if (live) setTranscript(live);
      if (!finalText) return;

      // The wake phrase is only listened for during a session the user started
      // explicitly. A fresh Browsery launch never starts recording by itself.
      const wake = /\b(?:hey|ok|okay)\s+groq\b/i.exec(finalText);
      if (wake) {
        const question = cleanTranscript(finalText.slice((wake.index || 0) + wake[0].length));
        finalText = '';
        if (question) {
          awaitingWakeCommand.current = false;
          stopRecognition({ stopVoiceSession: true });
          askGroq(question);
        } else {
          awaitingWakeCommand.current = true;
          setStatus('awaiting-command');
        }
        return;
      }
      if (awaitingWakeCommand.current) {
        const question = finalText;
        finalText = '';
        awaitingWakeCommand.current = false;
        stopRecognition({ stopVoiceSession: true });
        askGroq(question);
      }
    };
    recognition.onerror = event => {
      recognitionRef.current = null;
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatus('permission-denied');
        setVoiceSession(false);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setStatus('unsupported');
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      if (voiceSessionRef.current && !busyRef.current) {
        clearTimeout(restartTimer.current);
        restartTimer.current = window.setTimeout(() => startRecognition(), 280);
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { recognitionRef.current = null; setListening(false); }
  }, [askGroq, stopRecognition]);

  const enableVoiceSession = useCallback(() => {
    if (!window.browseryDesktop?.isDesktop) { setStatus('desktop-only'); return; }
    setAnswer('');
    setStatus('starting');
    setVoiceSession(true);
  }, []);

  useEffect(() => {
    if (voiceSession) startRecognition();
    else stopRecognition();
  }, [voiceSession, startRecognition, stopRecognition]);

  useEffect(() => {
    if (open) return;
    stopRecognition({ stopVoiceSession: true });
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch {} }
  }, [open, stopRecognition]);

  useEffect(() => () => {
    stopRecognition();
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch {} }
  }, [stopRecognition]);

  const submit = event => {
    event?.preventDefault?.();
    stopRecognition({ stopVoiceSession: true });
    askGroq(draft);
  };

  const listeningDescription = listening ? 'Listening for “Hey Groq”…' : status === 'awaiting-command' ? 'Wake word heard — say your question.' : 'Voice session is paused.';
  return <aside ref={panelRef} className={`drawer voice-assistant-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Hey Groq voice assistant">
    <div className="drawer-head voice-head"><div><span className="drawer-kicker">Groq · opt-in voice session</span><h2>Hey Groq</h2></div><CloseButton icon="close" label="Close Hey Groq" onClick={onClose}/></div>
    <div className="voice-body">
      <section className={`voice-orbit ${listening ? 'is-listening' : ''} ${status === 'thinking' ? 'is-thinking' : ''}`}>
        <span className="voice-core"><Icon name="spark" size={23}/></span><i/><i/><i/>
      </section>
      <div className="voice-state" aria-live="polite"><b>{status === 'thinking' ? 'Groq is thinking…' : voiceSession ? listeningDescription : 'Voice session is off'}</b><small>{voiceSession ? 'Say “Hey Groq” followed by a question.' : 'Press Start session to give Browsery microphone access for this session.'}</small></div>
      <div className="voice-controls">
        {voiceSession
          ? <Button className="voice-primary stop" onClick={() => stopRecognition({ stopVoiceSession: true })}><Icon name="pause" size={15}/><span>Stop session</span></Button>
          : <Button className="voice-primary" onClick={enableVoiceSession}><Icon name="spark" size={15}/><span>Start voice session</span></Button>}
        <Button className={`voice-speak-toggle ${speakAnswers ? 'on' : ''}`} onClick={() => setSpeakAnswers(value => !value)} aria-pressed={speakAnswers}><Icon name="volume" size={15}/><span>{speakAnswers ? 'Speak answers' : 'Text only'}</span></Button>
      </div>
      <section className="voice-examples" aria-label="Example questions">
        <span>Ask about Browsery</span>
        <div>{EXAMPLE_QUESTIONS.map(question => <button type="button" key={question} onClick={() => { stopRecognition({ stopVoiceSession: true }); askGroq(question); }} disabled={status === 'thinking'}>{question}</button>)}</div>
      </section>
      <form className="voice-compose" onSubmit={submit}>
        <label htmlFor="groq-voice-question">Ask in text</label>
        <textarea id="groq-voice-question" value={draft} onChange={event => setDraft(event.target.value.slice(0, 600))} placeholder="Type a question for Groq" rows="3" disabled={status === 'thinking'}/>
        <Button className="voice-send" type="submit" disabled={!draft.trim() || status === 'thinking'}><Icon name="forward" size={15}/><span>{status === 'thinking' ? 'Thinking…' : 'Ask Groq'}</span></Button>
      </form>
      {transcript && <section className="voice-transcript"><span>You said</span><p>{transcript}</p></section>}
      {answer && <section className="voice-answer"><div><Icon name="spark" size={15}/><b>Groq</b><Button className="voice-repeat" onClick={() => speak(answer)} aria-label="Read answer aloud" title="Read answer aloud"><Icon name="volume" size={14}/></Button></div><p>{answer}</p></section>}
      {status !== 'idle' && status !== 'listening' && status !== 'awaiting-command' && status !== 'starting' && status !== 'thinking' && status !== 'ready' && <div className="voice-error" role="status"><Icon name="alert" size={15}/><span>{statusMessage(status)}</span></div>}
      <p className="voice-privacy">Voice is always opt-in. Browsery only starts listening after you press Start session and stops when you close this panel or stop it. Your speech may be processed by your device or browser’s speech-recognition service; Browsery sends the resulting text—not audio—to Groq, with a short summary of Browsery’s state (a few settings, extension names, tab counts and, outside private sessions, the current site’s name and page title) so it can answer questions about the browser.</p>
    </div>
  </aside>;
}
