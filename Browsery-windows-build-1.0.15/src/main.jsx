import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useClickFeedback, useSpringInteraction, useSpringPresence } from './motion.js';
import { BrowseryAudioEngine } from './audio.js';
import { migrateAppearance, saturnTiltAngle } from './appearance.js';
import { ExtensionsDrawer } from './extensions.jsx';
import { createExtensionHost } from './extensions/host.js';
import { VoiceAssistantDrawer } from './voice-assistant.jsx';
import { PersonalCenter } from './personal-center.jsx';
import { AccountGate } from './account-gate.jsx';
import { LocalControlCenter } from './local-control.jsx';
import { SetupWizard, onboardingComplete, markOnboardingComplete } from './setup-wizard.jsx';
import { SupportDrawer } from './support.jsx';
import './styles.css';
import './motion.css';
import './sound.css';
import './cockpit.css';
import './monochrome.css';
import './daily-ui.css';
import './extensions.css';
import './voice-assistant.css';
import './personal-center.css';
import './account-gate.css';
import './local-control.css';
import './onboarding.css';
import './desktop-behavior.css';
import './performance.css';
import './polish.css';
import './setup-wizard.css';
import './support.css';
import './planetarium.css';

const Icon = ({ name, size = 18, stroke = 1.7 }) => {
  const paths = {
    back: <><path d="m15 18-6-6 6-6"/><path d="M9 12h12"/></>,
    forward: <><path d="m9 18 6-6-6-6"/><path d="M15 12H3"/></>,
    reload: <><path d="M20 6v5h-5"/><path d="M18.5 15a7.5 7.5 0 1 1-1-8.5L20 11"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    close: <><path d="m7 7 10 10M17 7 7 17"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"/></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.8 3.2 7.7 7.5 9.5 4.3-1.8 7.5-4.7 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-5"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 18v3h16v-3"/></>,
    bookmark: <path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4Z"/>,
    history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/></>,
    find: <><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5M8.5 10.7h4.4"/></>,
    zoomIn: <><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5M8.5 10.7h4.4m-2.2-2.2v4.4"/></>,
    zoomOut: <><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5M8.5 10.7h4.4"/></>,
    sliders: <><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="18" r="2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    vpn: <><path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="4" y="11" width="16" height="10" rx="3"/><path d="M12 15v2"/></>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    folder: <><path d="M3 6h7l2 2h9v11H3Z"/></>,
    folderPlus: <><path d="M3 6h7l2 2h9v11H3Z"/><path d="M16.5 12v5m-2.5-2.5h5"/></>,
    pin: <><path d="m8 4 8 0 0 5 2 3H6l2-3Z"/><path d="m12 12 0 8"/></>,
    reopen: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 9"/><path d="M4 4v5h5"/><path d="M12 8v4l2.7 1.6"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    import: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 18v3h16v-3"/></>,
    export: <><path d="M12 21V9m-4 4 4-4 4 4"/><path d="M4 6V3h16v3"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6Z"/></>,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.8c-.9.8-1.9 1.2-1.9 2.7"/><path d="M12 17h.01"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    extension: <path d="M5 4h5v2a2 2 0 1 0 4 0V4h5v5h-2a2 2 0 1 0 0 4h2v7h-7v-2a2 2 0 1 0-4 0v2H5v-7h2a2 2 0 1 0 0-4H5Z"/>,
    volume: <><path d="M4 10v4h4l5 4V6l-5 4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></>,
    music: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.7"/><path d="M6 5.5 7.7 8M18 16l1.7 2.5M18.5 5.5 16.3 8M5.5 18.5 8 16.3"/></>,
    previous: <><path d="m19 6-8 6 8 6V6ZM5 6v12"/></>,
    next: <><path d="m5 6 8 6-8 6V6Zm14 0v12"/></>,
    windowMin: <path d="M5 12h14"/>,
    windowMax: <rect x="5" y="5" width="14" height="14" rx="1.5"/>,
    windowClose: <><path d="m6 6 12 12M18 6 6 18"/></>,
    cookie: <><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a3 3 0 0 0 4 4 3 3 0 0 0 2.7 4.3 3 3 0 0 0 3 1.4Z"/><circle cx="8" cy="9" r=".8"/><circle cx="7.5" cy="14" r=".8"/><circle cx="12" cy="17" r=".8"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5ZM8 7h8M8 11h6"/></>,
    speaker: <><path d="M4 10v4h4l5 4V6l-5 4Z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/></>,
    pip: <><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/></>,
    gauge: <><path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13.5" r="1.2"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5"/></>,
    camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></>,
    droplet: <path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
    braces: <><path d="M8 4c-2 0-2.5 1-2.5 3v2c0 1.5-.8 2.5-2 3 1.2.5 2 1.5 2 3v2c0 2 .5 3 2.5 3"/><path d="M16 4c2 0 2.5 1 2.5 3v2c0 1.5.8 2.5 2 3-1.2.5-2 1.5-2 3v2c0 2-.5 3-2.5 3"/></>,
    focus: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/><path d="M5 3.5 3 5.5M19 3.5l2 2"/></>,
    note: <><path d="M5 3h10l4 4v14H5Z"/><path d="M15 3v4h4M8.5 12h7M8.5 16h5"/></>,
    quote: <><path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h4v5H5"/><path d="M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h4v5h-4"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
    refresh: <><path d="M20 5v5h-5"/><path d="M4 19v-5h5"/><path d="M5.6 9a7 7 0 0 1 12.2-1.6L20 10M18.4 15a7 7 0 0 1-12.2 1.6L4 14"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/></>,
    support: <><path d="M4 5h16v11H10l-4.5 3.5V16H4Z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 8c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

function FavoriteIcon({name}) {
  const content={
    Canvas:<><ellipse cx="16" cy="16" rx="9" ry="9"/><ellipse cx="16" cy="16" rx="16" ry="4.7" transform="rotate(-28 16 16)"/></>,
    Linear:<><circle cx="16" cy="16" r="12" fill="currentColor" stroke="none"/><path d="m4 11 17 17M4 17l11 11M7 7l19 19M11 4l17 17" stroke="#111111" strokeWidth="2.7"/></>,
    Docs:<><path d="M8 3h11l6 6v20H8Z" fill="currentColor" stroke="none"/><path d="M19 3v7h6" fill="#cccccc" stroke="none"/><path d="M12 15h9M12 19h9M12 23h6" stroke="#111111" strokeWidth="2"/></>,
    GitHub:<><circle cx="16" cy="16" r="13" fill="currentColor" stroke="none"/><path d="M10 26v-5c-4 1-4-2-6-2m14 7v-6c3-1 5-3 5-6 0-2-1-3-2-4 0-1 0-3-1-4l-4 2h-4L8 6c-1 1-1 3-1 4-1 1-2 2-2 4 0 3 2 5 5 6" fill="#111111" stroke="#111111" strokeWidth="1.6"/></>,
    Music:<><path d="M12 22V7l14-3v15M12 11l14-3" strokeWidth="3.2"/><ellipse cx="8" cy="23" rx="4.6" ry="3.4" fill="currentColor" stroke="none"/><ellipse cx="22" cy="20" rx="4.6" ry="3.4" fill="currentColor" stroke="none"/></>,
  };
  return <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{content[name]}</svg>;
}

function faviconSource(url, supplied='') {
  const candidate=supplied||url;
  try {
    const parsed=new URL(candidate);
    if(!/^https?:$/.test(parsed.protocol)) return '';
    // First-party favicon URLs keep Browsery independent from a third-party
    // favicon service and work for the overwhelming majority of websites.
    return supplied||new URL('/favicon.ico',parsed.origin).href;
  } catch { return ''; }
}

function faviconFallback(title,url) {
  if(!url) return '✦';
  try { return new URL(url).hostname.replace(/^www\./,'').slice(0,1).toUpperCase()||'•'; }
  catch { return String(title||url).trim().slice(0,1).toUpperCase()||'•'; }
}

function Favicon({url,title,favicon,className=''}) {
  const source=useMemo(()=>faviconSource(url,favicon),[url,favicon]);
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[source]);
  return <span className={`favicon ${className}`}>{source&&!failed?<img src={source} alt="" draggable="false" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<b aria-hidden="true">{faviconFallback(title,url)}</b>}</span>;
}

function SpringButton({spring='snappy',hoverScale=1.045,pressScale=.94,className='',style,children,...props}) {
  const interactions=useSpringInteraction({preset:spring,hoverScale,pressScale});
  // Preserve caller handlers as well as the interruptible spring handlers.
  const handlers=Object.fromEntries(Object.entries(interactions).map(([name,handler])=>[name,event=>{props[name]?.(event);if(!event.defaultPrevented&&!event.currentTarget.disabled)handler(event)}]));
  return <button {...props} {...handlers} className={`spring-interactive ${className}`} style={{'--spring-scale':1,...style}}>{children}</button>;
}

const settingsSchema = [
  { id:'graphics', label:'Graphics', icon:'grid', items:[
    ['gpu','GPU acceleration','toggle',true],['particles','Particle density','range',48],['aa','Anti-aliasing','select','TAA'],['fps','Frame rate limit','select','60 FPS'],['depth','3D depth intensity','range',58],['power','Low-power mode','toggle',false],['texture','Texture resolution','select','High'],['shadows','Dynamic shadows','toggle',true],['bloom','Specular bloom','range',44],['dpr','Pixel density','select','Auto'] ]},
  { id:'spatial', label:'Spatial UI', icon:'spark', items:[
    ['blur','Glass blur','range',64],['glow','Border glow','color','#ffffff'],['opacity','Panel opacity','range',74],['tilt','Spatial tilt angle','range',38],['speed','Animation speed','range',62],['motionStrength','Click energy','range',78],['trail','Cursor trail','select','Ribbon'],['refraction','Dynamic refraction','toggle',true],['parallax','Spatial overlay parallax','toggle',true],['shards','Floating shards','toggle',true],['corners','Corner geometry','select','Soft'] ]},
  { id:'privacy', label:'Privacy', icon:'shield', items:[
    ['adblock','Ad blocker','toggle',true],['trackers','Tracker blocking','select','Strict'],['https','HTTPS enforcement','toggle',true],['phishing','Suspicious-link guard','toggle',true],['dnt','Global privacy control','toggle',true],['cookies','Cookie purge timer','select','24 hours'],['private','Private session mode','toggle',false],['doh','DNS over HTTPS','toggle',true],['fingerprint','Fingerprint defense','toggle',true],['webrtc','WebRTC protection','toggle',true],['telemetry','Anonymous telemetry','toggle',false] ]},
  { id:'browser', label:'Browser', icon:'globe', items:[
    ['tabs','Tab layout','select','Horizontal'],['engine','Search engine','select','Browsery'],['homepage','Homepage','select','New Space'],['homepageUrl','Custom homepage URL','text','https://example.com'],['path','Download path','select','Downloads'],['suggestions','Search suggestions','toggle',true],['sleep','Sleeping tabs','toggle',true],['unloadAfter','Unload inactive tabs','select','30 minutes'],['restore','Restore last session','toggle',true],['preload','Predictive preload','toggle',false],['compact','Compact tab mode','toggle',false],['closewarn','Close warning','toggle',true] ]},
  { id:'ai', label:'AI Overview', icon:'spark', items:[
    ['aiOverview','Groq web overview','toggle',true],['aiModel','Groq model','select','openai/gpt-oss-120b'] ]},
  { id:'sound', label:'Sound', icon:'volume', items:[
    ['ambience','Ambient space soundscape','toggle',true],['ambienceVolume','Ambience volume','range',58],['clicks','Spatial UI clicks','toggle',true],['hover','Hover sound feedback','toggle',false],['master','Browsery audio volume','range',48],['visualizer','Live audio visualizer','toggle',true],['mutetabs','Mute background tabs','toggle',true],['startup','Startup sound','toggle',false],['downloadtone','Download complete tone','toggle',true],['haptic','Haptic pulse strength','range',28],['theme','Sound theme','select','Crystalline'],['spatialaudio','Spatial audio field','toggle',true] ]},
  { id:'customize', label:'Customize', icon:'sliders', items:[
    ['accentPreset','Accent theme','select','Monochrome'],['systemContrast','Use Windows contrast theme','toggle',true],['backgroundScene','Background scenery','select','Original Saturn'],['saturnTilt','Saturn tilt','angle',-24],['backgroundBrightness','Background brightness','range',50],['backgroundContrast','Background contrast','range',50],['videoSpeed','Saturn motion speed','range',50],['clockStyle','Clock style','select','24-hour'],['showFavorites','Show shortcut dock','toggle',true],['chromeDensity','Chrome density','select','Comfortable'],['cornerStyle','Panel corners','select','Rounded'],['fontScale','Interface scale','range',50],['cursorEnabled','Cursor particle trail','toggle',true],['cursorSize','Trail particle size','range',46] ]}
];

const initialSettings = Object.fromEntries(settingsSchema.flatMap(category => category.items.map(([id,,,value]) => [id,value])));
const favoriteUrls = { Canvas:'https://www.figma.com', Linear:'https://linear.app', Docs:'https://docs.google.com', GitHub:'https://github.com', Music:'https://music.youtube.com' };

function useBrowseryAudio(settings) {
  const [audioEngine] = useState(() => new BrowseryAudioEngine());
  const [audioReady,setAudioReady] = useState(false);
  const currentSettings = useRef(settings);

  useEffect(() => { currentSettings.current=settings;audioEngine.setSettings(settings); }, [audioEngine,settings]);
  useEffect(() => {
    let mounted = true;
    const wake = () => audioEngine.unlock().then(ready => { if (mounted && ready) setAudioReady(true); });
    const interactive = target => target?.closest?.('button,a,[role="button"],select,input[type="range"]');
    const pointerDown = event => {
      if (event.button !== 0) return;
      wake();
      if (interactive(event.target)) audioEngine.play('click',event.clientX/Math.max(innerWidth,1));
    };
    const pointerOver = event => {
      if (event.pointerType === 'touch' || !currentSettings.current.hover) return;
      const entering = interactive(event.target);
      if (!entering || entering === interactive(event.relatedTarget)) return;
      audioEngine.play('hover',event.clientX/Math.max(innerWidth,1));
    };
    const keyDown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = interactive(event.target);
      if (!target) return;
      wake();
      audioEngine.play('click',target.getBoundingClientRect().left/Math.max(innerWidth,1));
    };
    // Nothing is audible while Browsery is minimized or hidden, so let the audio graph sleep.
    const visibility = () => { if (document.hidden) audioEngine.sleep(); else audioEngine.wake(); };
    document.addEventListener('pointerdown',pointerDown,true);
    document.addEventListener('pointerover',pointerOver,true);
    document.addEventListener('keydown',keyDown,true);
    document.addEventListener('visibilitychange',visibility);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange',visibility);
      document.removeEventListener('pointerdown',pointerDown,true);
      document.removeEventListener('pointerover',pointerOver,true);
      document.removeEventListener('keydown',keyDown,true);
    };
  },[audioEngine]);

  return {audioEngine,audioReady};
}

function SoundVisualizer({audioEngine,enabled}) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const analyser = audioEngine.getAnalyser();
    if (!canvas || !context || !analyser) return undefined;

    const ratio = Math.min(window.devicePixelRatio || 1,2);
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.round(bounds.width*ratio);
    canvas.height = Math.round(bounds.height*ratio);
    context.scale(ratio,ratio);
    const bars = 18;
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0, last = 0;
    const draw = now => {
      frame = requestAnimationFrame(draw);
      // About 20 frames per second is plenty for a level meter.
      if (document.hidden || now - last < 50) return;
      last = now;
      analyser.getByteFrequencyData(samples);
      const width = bounds.width;
      const height = bounds.height;
      const gap = 2;
      const barWidth = (width-gap*(bars-1))/bars;
      context.clearRect(0,0,width,height);
      for (let index=0;index<bars;index+=1) {
        const sampleIndex = Math.min(samples.length-1,Math.max(1,Math.floor((index+1)*samples.length/(bars*2))));
        const level = samples[sampleIndex]/255;
        const barHeight = Math.max(2,level*(height-3));
        context.fillStyle = `rgba(240,240,240,${0.24+level*0.7})`;
        context.fillRect(index*(barWidth+gap),height-barHeight,barWidth,barHeight);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  },[audioEngine,enabled]);

  if (!enabled) return null;
  return <div className="sound-visualizer" aria-label="Live ambient sound level" role="img"><span>Ambient sound</span><canvas ref={canvasRef}/></div>;
}

function resolveAddress(input, engine='Browsery') {
  const value=input.trim();
  if(!value)return null;
  if(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value))return value;
  if(/^localhost(?::\d+)?(?:\/.*)?$/.test(value))return `http://${value}`;
  if(!value.includes(' ') && value.includes('.'))return `https://${value}`;
  if(engine==='Browsery' && window.browseryDesktop?.isDesktop)return `browsery://search/?q=${encodeURIComponent(value)}`;
  const endpoints={Browsery:'https://www.mojeek.com/search?q=',Mojeek:'https://www.mojeek.com/search?q=',DuckDuckGo:'https://duckduckgo.com/?q=',Bing:'https://www.bing.com/search?q='};
  return `${endpoints[engine]||endpoints.Browsery}${encodeURIComponent(value)}`;
}

// This is deliberately a local URL check, not a pretend virus scanner. It
// catches a few high-confidence phishing patterns before a webview loads them.
function suspiciousUrl(value) {
  try {
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol))return null;
    const host=url.hostname.toLowerCase();
    const ipHost=/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    if(url.username||url.password)return 'This address hides credentials before the real destination.';
    if(host.includes('xn--'))return 'This address uses an internationalized look-alike domain.';
    if(ipHost&&/(login|signin|verify|wallet|account|password)/i.test(`${url.pathname}${url.search}`))return 'A sign-in or account page is being served from a raw IP address.';
    if(/(?:secure|verify|account|login|signin|wallet|password)[.-](?:secure|verify|account|login|signin|wallet|password)/i.test(host))return 'This address combines account and verification terms often used in phishing links.';
  } catch {}
  return null;
}

const favorites = [
  {label:'Canvas', glyph:'◒', color:'#74e8ff'},
  {label:'Linear', glyph:'◫', color:'#b7a4ff'},
  {label:'Docs', glyph:'▤', color:'#68a7ff'},
  {label:'GitHub', glyph:'◉', color:'#e4e9ff'},
  {label:'Music', glyph:'♫', color:'#ff79dc'},
];

const defaultShortcuts=favorites.map((item,index)=>({
  id:`built-in-${index}`,
  label:item.label,
  url:favoriteUrls[item.label],
  color:item.color,
}));

function WebGLScene({ pointer, settings }) {
  const mount = useRef(null);
  const liveSettings = useRef(settings);
  liveSettings.current = settings;
  useEffect(() => {
    if (!mount.current || !settings.gpu || settings.power || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const host = mount.current;
    let cancelled = false;
    let cleanup = () => {};
    import('three').then(THREE => {
      if (cancelled) return;
      try {
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: settings.aa !== 'Off', powerPreference: 'high-performance' });
        const selectedDpr = settings.dpr === 'Auto' ? Math.min(window.devicePixelRatio || 1, 1.25) : Number.parseFloat(settings.dpr) || 1;
        renderer.setPixelRatio(Math.min(selectedDpr, 1.5));
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(48, 1, .1, 90);
        camera.position.z = 10;
        scene.add(new THREE.AmbientLight(0x92baff, 1.05));
        const cyanLight = new THREE.PointLight(0x60deff, 19, 24);
        cyanLight.position.set(-4, 3.5, 5);
        scene.add(cyanLight);
        const violetLight = new THREE.PointLight(0x8f6dff, 15, 22);
        violetLight.position.set(5, -2.5, 3);
        scene.add(violetLight);

        const palettes = [0x76e7ff, 0x8f7dff, 0xee87e7, 0xb9f3ff];
        // Keep the geometry stable while the density sliders move. Recreating a WebGL
        // context on every range input event was the largest avoidable hitch here.
        const maxShardCount = 14;
        const maxStarCount = 560;
        const shardCountFor = live => live.shards
          ? Math.min(maxShardCount, Math.round(7 + (Number(live.particles) || 0) * .075))
          : 0;
        const starCountFor = live => Math.max(0, Math.min(maxStarCount, Math.round(160 + (Number(live.particles) || 0) * 4)));
        const shardGeometry = new THREE.IcosahedronGeometry(.56, 0);
        const edgeGeometry = new THREE.EdgesGeometry(shardGeometry, 14);
        const shardMaterials = palettes.map(color => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: .34, roughness: .32, metalness: .12, emissive: color, emissiveIntensity: .1, side: THREE.DoubleSide, depthWrite: false }));
        const edgeMaterials = palettes.map(color => new THREE.LineBasicMaterial({ color, transparent: true, opacity: .68, depthWrite: false }));
        const shards = Array.from({ length: maxShardCount }, (_, index) => {
          const angle = (index / maxShardCount) * Math.PI * 2;
          const radius = 4.45 + (index % 4) * .62;
          const materialIndex = index % palettes.length;
          const mesh = new THREE.Mesh(shardGeometry, shardMaterials[materialIndex]);
          const edges = new THREE.LineSegments(edgeGeometry, edgeMaterials[materialIndex]);
          mesh.add(edges);
          mesh.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.13) * (2.5 + (index % 3) * .42), -1.5 - (index % 5) * .9);
          mesh.scale.set(.55 + (index % 3) * .2, .82 + (index % 4) * .26, .55 + (index % 2) * .18);
          mesh.rotation.set(index * .63, index * .91, index * .35);
          mesh.userData.baseY = mesh.position.y;
          mesh.userData.phase = index * .73;
          scene.add(mesh);
          return mesh;
        });

        const orbitGroup = new THREE.Group();
        orbitGroup.position.set(2.15, -.05, -2.8);
        scene.add(orbitGroup);
        const orbitRings = [];
        [2.9, 3.26, 3.62].forEach((radius, index) => {
          const ringMaterial = new THREE.MeshBasicMaterial({ color: palettes[index], transparent: true, opacity: .2 + index * .035, depthWrite: false, side: THREE.DoubleSide });
          const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .009 + index * .002, 5, 180), ringMaterial);
          ring.rotation.set(.56 + index * .13, .22 + index * .19, index * .48);
          ring.scale.set(1.16, .73 + index * .1, 1);
          orbitGroup.add(ring);
          orbitRings.push(ring);
        });

        const starsGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxStarCount * 3);
        for (let index = 0; index < positions.length; index += 3) {
          positions[index] = (Math.random() - .5) * 23;
          positions[index + 1] = (Math.random() - .5) * 14;
          positions[index + 2] = -Math.random() * 15;
        }
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starsMaterial = new THREE.PointsMaterial({ color: 0xa8d8ff, size: .028, transparent: true, opacity: .82, sizeAttenuation: true, depthWrite: false });
        const stars = new THREE.Points(starsGeometry, starsMaterial);
        scene.add(stars);

        let frame = 0;
        let lastFrame = 0;
        let elapsed = 0;
        let inView = true;
        let visibleShardCount = -1;
        let visibleStarCount = -1;
        const applyDensity = live => {
          const nextShardCount = shardCountFor(live);
          if (nextShardCount !== visibleShardCount) {
            visibleShardCount = nextShardCount;
            shards.forEach((shard, index) => { shard.visible = index < nextShardCount; });
          }
          const nextStarCount = starCountFor(live);
          if (nextStarCount !== visibleStarCount) {
            visibleStarCount = nextStarCount;
            starsGeometry.setDrawRange(0, nextStarCount);
          }
        };
        applyDensity(liveSettings.current);
        const visibilityObserver = new IntersectionObserver(entries => {
          inView = entries[0]?.isIntersecting ?? true;
          if (inView && !document.hidden && !frame) frame = requestAnimationFrame(render);
          if (!inView && frame) { cancelAnimationFrame(frame); frame = 0; }
        }, { threshold: 0 });
        visibilityObserver.observe(host);
        const resize = () => {
          const bounds = host.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setSize(bounds.width, bounds.height, false);
          camera.aspect = bounds.width / bounds.height;
          camera.updateProjectionMatrix();
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const render = now => {
          frame = 0;
          if (document.hidden || !inView) return;
          const live = liveSettings.current;
          const maxFps = Math.min(144, Number.parseInt(live.fps, 10) || 60);
          if (now - lastFrame >= 1000 / maxFps) {
            const delta = Math.min((now - lastFrame) / 16.67, 2);
            lastFrame = now;
            const speed = .35 + (live.speed || 60) / 70;
            applyDensity(live);
            elapsed += .016 * delta * speed;
            const intensity = .11 + ((live.depth || 50) / 100) * .18;
            const pointerFollow = 1 - Math.exp(-.13 * delta);
            scene.rotation.y += ((live.parallax ? pointer.current.x : 0) * intensity - scene.rotation.y) * pointerFollow;
            scene.rotation.x += (-(live.parallax ? pointer.current.y : 0) * intensity * .78 - scene.rotation.x) * pointerFollow;
            for (let index = 0; index < visibleShardCount; index += 1) {
              const shard = shards[index];
              shard.rotation.x += .004 * delta * (1 + index % 3) * speed;
              shard.rotation.y += .006 * delta * speed;
              shard.position.y = shard.userData.baseY + Math.sin(elapsed * 1.7 + shard.userData.phase) * .22;
              shard.position.x += Math.sin(elapsed + shard.userData.phase) * .0012 * delta;
            }
            orbitGroup.rotation.z = Math.sin(elapsed * .16) * .09;
            orbitRings.forEach((ring, index) => { ring.rotation.z += (index % 2 ? -1 : 1) * .00055 * delta * speed; });
            stars.rotation.z = Math.sin(elapsed * .08) * .012;
            stars.position.y = Math.sin(elapsed * .35) * .09;
            renderer.render(scene, camera);
          }
          frame = requestAnimationFrame(render);
        };
        const onVisibilityChange = () => {
          if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
          else if (inView && !frame) frame = requestAnimationFrame(render);
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        frame = requestAnimationFrame(render);

        cleanup = () => {
          cancelAnimationFrame(frame);
          document.removeEventListener('visibilitychange', onVisibilityChange);
          resizeObserver.disconnect();
          visibilityObserver.disconnect();
          shardMaterials.forEach(material => material.dispose());
          edgeMaterials.forEach(material => material.dispose());
          orbitRings.forEach(ring => { ring.geometry.dispose(); ring.material.dispose(); });
          shardGeometry.dispose();
          edgeGeometry.dispose();
          starsGeometry.dispose();
          starsMaterial.dispose();
          renderer.domElement.remove();
          renderer.dispose();
          renderer.forceContextLoss?.();
          scene.clear();
        };
      } catch (error) {
        console.warn('Browsery spatial scene could not initialize:', error.message);
      }
    }).catch(error => console.warn('Browsery could not load its spatial renderer:', error.message));
    return () => { cancelled = true; cleanup(); };
  }, [pointer, settings.gpu, settings.power, settings.aa, settings.dpr]);
  return <div className="webgl" ref={mount} aria-hidden="true"/>;
}

function MagicCursor({settings}) {
  const canvas=useRef(null);
  const dot=useRef(null);
  const ring=useRef(null);
  const liveSettings=useRef(settings);
  liveSettings.current=settings;
  useEffect(()=>{
    if(!settings.cursorEnabled||settings.power||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return undefined;
    const surface=canvas.current,ctx=surface?.getContext('2d',{alpha:true,desynchronized:true});
    if(!ctx)return undefined;
    let particles=[],frame=0,lastFrame=0,lastSpawn=0,dirty=null,activeHue=0,lastX=Number.NaN,lastY=Number.NaN,width=0,height=0;
    let pointerFrame=0,pointerX=-80,pointerY=-80,ringX=-80,ringY=-80,hasPointer=false;
    const pixelRatio=1;
    const trailHue=trail=>trail==='Comet'?38:trail==='Dust'?205:285;
    // The visible cursor is an immediate compositor-only DOM layer. The
    // canvas is only the optional, deliberately sparse after-trail.
    const capFor=live=>Math.min(12,Math.max(4,Math.round(4+Math.max(0,Number(live.particles)||0)/100*8)));
    const resize=()=>{width=innerWidth;height=innerHeight;surface.width=Math.round(width*pixelRatio);surface.height=Math.round(height*pixelRatio);surface.style.width=`${width}px`;surface.style.height=`${height}px`;ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);ctx.clearRect(0,0,width,height);dirty=null};
    const schedule=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(draw)};
    const paintPointer=()=>{
      pointerFrame=0;
      if(!hasPointer||document.hidden)return;
      // A small follow value gives the ring physical continuity without ever
      // making the real pointer wait for a simulation frame.
      ringX+=(pointerX-ringX)*.42;
      ringY+=(pointerY-ringY)*.42;
      dot.current?.style.setProperty('transform',`translate3d(${pointerX}px,${pointerY}px,0)`);
      ring.current?.style.setProperty('transform',`translate3d(${ringX}px,${ringY}px,0)`);
      if(Math.abs(pointerX-ringX)>.15||Math.abs(pointerY-ringY)>.15)pointerFrame=requestAnimationFrame(paintPointer);
    };
    const schedulePointer=()=>{if(!pointerFrame)pointerFrame=requestAnimationFrame(paintPointer)};
    const spawn=(x,y,count=1)=>{const live=liveSettings.current,trail=live.trail||'Ribbon',particleScale=.75+(Number(live.cursorSize)||46)*.006;for(let i=0;i<count;i++){const angle=Math.random()*Math.PI*2,speed=.35+Math.random()*(trail==='Dust'?1.2:.72);particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:1,size:(Math.random()*1.6+.8)*particleScale,hue:activeHue+Math.random()*24})}const cap=capFor(live);if(particles.length>cap)particles.splice(0,particles.length-cap);schedule()};
    const move=e=>{
      if(document.hidden||e.pointerType==='touch')return;
      const now=performance.now(),x=e.clientX,y=e.clientY,dx=x-lastX,dy=y-lastY;
      pointerX=x;pointerY=y;
      if(!hasPointer){hasPointer=true;ringX=x;ringY=y;dot.current?.classList.add('is-visible');ring.current?.classList.add('is-visible')}
      schedulePointer();
      // A trail is sampled sparsely; it is visual detail, never a cursor
      // replacement. This caps CPU/GPU work during fast page scrolling.
      if(now-lastSpawn<72||(Number.isFinite(dx)&&dx*dx+dy*dy<81))return;
      lastSpawn=now;lastX=x;lastY=y;
      const target=e.target;
      const overControl=target instanceof Element&&target.closest('button,a,[role="button"],input,select');
      activeHue=overControl?190:trailHue(liveSettings.current.trail);
      ring.current?.classList.toggle('is-interactive',Boolean(overControl));
      spawn(x,y);
    };
    const down=e=>spawn(e.clientX,e.clientY,4);
    const draw=now=>{
      frame=0;
      if(document.hidden)return;
      if(now-lastFrame<42){schedule();return}
      lastFrame=now;
      if(dirty)ctx.clearRect(dirty.left,dirty.top,dirty.right-dirty.left,dirty.bottom-dirty.top);
      const live=liveSettings.current,trail=live.trail||'Ribbon',saturation=live.accentPreset==='Monochrome'?0:100;
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vx*=.986;p.vy*=.986;p.life*=trail==='Comet' ? .965 : trail==='Dust' ? .91 : .94;if(p.life<.06){particles.splice(i,1);continue}const radius=p.size*p.life;ctx.beginPath();ctx.fillStyle=`hsla(${p.hue},${saturation}%,${68+p.life*16}%,${p.life*.72})`;ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();left=Math.min(left,p.x-radius-3);top=Math.min(top,p.y-radius-3);right=Math.max(right,p.x+radius+3);bottom=Math.max(bottom,p.y+radius+3)}
      dirty=Number.isFinite(left)?{left:Math.max(0,left),top:Math.max(0,top),right:Math.min(width,right),bottom:Math.min(height,bottom)}:null;
      if(particles.length)schedule();
    };
    const leave=()=>{hasPointer=false;dot.current?.classList.remove('is-visible');ring.current?.classList.remove('is-visible','is-interactive')};
    const visibility=()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);if(pointerFrame)cancelAnimationFrame(pointerFrame);frame=0;pointerFrame=0;particles=[];dirty=null;ctx.clearRect(0,0,width,height)}else if(particles.length)schedule()};
    resize();activeHue=trailHue(liveSettings.current.trail);addEventListener('pointermove',move,{passive:true});addEventListener('pointerdown',down,{passive:true});addEventListener('resize',resize,{passive:true});document.addEventListener('visibilitychange',visibility);
    addEventListener('blur',leave);document.addEventListener('mouseleave',leave);
    return()=>{if(frame)cancelAnimationFrame(frame);if(pointerFrame)cancelAnimationFrame(pointerFrame);removeEventListener('pointermove',move);removeEventListener('pointerdown',down);removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);removeEventListener('blur',leave);document.removeEventListener('mouseleave',leave)};
  },[settings.cursorEnabled,settings.power]);
  if(!settings.cursorEnabled||settings.power)return null;
  return <><canvas className="cursor-canvas" ref={canvas} aria-hidden="true"/><span className="cursor-dot browsery-pointer-dot" ref={dot} aria-hidden="true"/><span className="cursor-ring browsery-pointer-ring" ref={ring} aria-hidden="true"/></>;
}

function GlassButton({icon,label,onClick,active,className='',tour,...props}) { return <SpringButton {...props} data-tour={tour} className={`icon-button magnetic ${active?'active':''} ${className}`} onClick={onClick} aria-label={label} title={label}><Icon name={icon}/></SpringButton> }

function LaunchScreen({onComplete}) {
  const [phase,setPhase]=useState('video');
  useEffect(()=>{
    // Local media normally ends at ten seconds; release the app if decoding fails.
    const fallback=setTimeout(()=>setPhase('brand'),15000);
    return()=>clearTimeout(fallback);
  },[]);
  useEffect(()=>{
    if(phase!=='brand')return undefined;
    const timer=setTimeout(onComplete,1400);
    return()=>clearTimeout(timer);
  },[phase,onComplete]);
  return <div className={`launch-screen launch-${phase}`} role="status" aria-label="Launching Browsery">
    {phase==='video'?<video className="launch-reference-video" src="./assets/terminal-loading.mp4" autoPlay muted playsInline preload="auto" onTimeUpdate={event=>{const video=event.currentTarget;if(video.duration&&video.currentTime>=video.duration-.08)setPhase('brand')}} onEnded={()=>setPhase('brand')} onError={()=>setPhase('brand')} aria-label="Browsery loading video"/>:<div className="launch-final-brand" aria-label="Browsery"><img src="./assets/browsery-icon.png" alt=""/><span>Browsery</span></div>}
  </div>;
}

function TabContextMenu({menu,groups,onClose,onPin,onCloseTab,onCloseOthers,onCloseRight,onSetGroup,onCreateGroup}) {
  useEffect(()=>{
    if(!menu)return undefined;
    const keydown=event=>{if(event.key==='Escape')onClose()};
    addEventListener('keydown',keydown);
    return()=>removeEventListener('keydown',keydown);
  },[menu,onClose]);
  if(!menu)return null;
  const select=action=>{action();onClose()};
  return <div className="tab-context-menu" role="menu" aria-label={`Actions for ${menu.tab.title}`} style={{left:menu.x,top:menu.y}} onPointerDown={event=>event.stopPropagation()}>
    <div className="tab-menu-heading"><Favicon url={menu.tab.url} title={menu.tab.title} favicon={menu.tab.favicon}/><span>{menu.tab.title||'New tab'}</span></div>
    <button type="button" role="menuitem" onClick={()=>select(()=>onPin(menu.tab.id))}><Icon name="pin" size={15}/>{menu.tab.pinned?'Unpin tab':'Pin tab'}</button>
    <button type="button" role="menuitem" onClick={()=>select(()=>onCloseTab(menu.tab.id))}><Icon name="close" size={15}/>Close tab</button>
    <button type="button" role="menuitem" onClick={()=>select(()=>onCloseOthers(menu.tab.id))}><Icon name="close" size={15}/>Close other tabs</button>
    <button type="button" role="menuitem" onClick={()=>select(()=>onCloseRight(menu.tab.id))}><Icon name="close" size={15}/>Close tabs to the right</button>
    <div className="tab-menu-separator"/>
    <span className="tab-menu-label">Move to group</span>
    <button type="button" role="menuitem" className={!menu.tab.groupId?'selected':''} onClick={()=>select(()=>onSetGroup(menu.tab.id,null))}><span className="group-dot neutral"/>No group</button>
    {groups.map(group=><button type="button" role="menuitem" className={menu.tab.groupId===group.id?'selected':''} key={group.id} onClick={()=>select(()=>onSetGroup(menu.tab.id,group.id))}><span className="group-dot" style={{'--group-color':group.color}}/>{group.name}</button>)}
    <button type="button" role="menuitem" className="tab-menu-new-group" onClick={()=>select(()=>onCreateGroup(menu.tab.id))}><Icon name="folderPlus" size={15}/>New group…</button>
  </div>;
}

function TabStrip({tabs,setTabs,active,setActive,onNewTab,onCloseTab,onReopenClosed,closedCount=0,groups=[],onCloseOthers,onCloseRight,onSetGroup,onCreateGroup,unloaded}) {
  const drag=useRef(null),rowRef=useRef(null);
  const [menu,setMenu]=useState(null);
  const orderedTabs=useMemo(()=>[...tabs].sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))),[tabs]);
  const groupById=useMemo(()=>new Map(groups.map(group=>[group.id,group])),[groups]);
  const pinTab=useCallback(id=>setTabs(current=>current.map(tab=>tab.id===id?{...tab,pinned:!tab.pinned}:tab)),[setTabs]);
  const drop=id=>{if(drag.current===id||drag.current==null)return;const next=[...tabs],from=next.findIndex(t=>t.id===drag.current),to=next.findIndex(t=>t.id===id);if(from<0||to<0)return;const [m]=next.splice(from,1);next.splice(to,0,m);setTabs(next);drag.current=null};
  const openMenu=(event,tab)=>{
    event.preventDefault();
    const bounds=rowRef.current?.getBoundingClientRect();
    const x=Math.max(8,Math.min((event.clientX-(bounds?.left||0)),(bounds?.width||420)-238));
    setMenu({tab,x,y:(bounds?.height||58)-2});
  };
  return <div ref={rowRef} className={`tabs-row ${menu?'tab-menu-open':''}`} data-tour="tabs">
    <div className="brand" data-magnetic><span className="brand-orb"><i/><b/><em/></span><span className="brand-name">Browsery</span></div>
    <div className="tabs">{orderedTabs.map(t=>{
      const group=t.groupId?groupById.get(t.groupId):null;
      return <SpringButton spring="fluid" hoverScale={1.012} pressScale={.975} draggable onDragStart={()=>drag.current=t.id} onDragEnd={()=>{drag.current=null}} onDragOver={event=>event.preventDefault()} onDrop={()=>drop(t.id)} onClick={()=>setActive(t.id)} onAuxClick={event=>{if(event.button===1){event.preventDefault();onCloseTab(t.id)}}} onContextMenu={event=>openMenu(event,t)} className={`tab ${active===t.id?'selected':''} ${t.pinned?'pinned':''} ${group?'has-group':''} ${unloaded?.has(t.id)?'is-unloaded':''}`} style={group?{'--group-color':group.color}:undefined} key={t.id} title={unloaded?.has(t.id)?`${t.title} · unloaded to save memory`:t.title}>
        <Favicon className="tab-favicon" url={t.url} title={t.title} favicon={t.favicon}/>{group&&<span className="tab-group-dot" title={group.name}/>}<span className="tab-title">{t.title}</span>{t.pinned&&<span className="tab-pin" title="Pinned"><Icon name="pin" size={11}/></span>}<span onClick={event=>{event.stopPropagation();onCloseTab(t.id)}} role="button" aria-label={`Close ${t.title}`} className="tab-close"><Icon name="close" size={13}/></span>
      </SpringButton>;
    })}</div>
    <GlassButton icon="reopen" label={closedCount?'Reopen closed tab · Ctrl+Shift+T':'No closed tabs'} onClick={onReopenClosed} disabled={!closedCount} className="reopen-tab"/>
    <GlassButton icon="plus" label="New tab" onClick={onNewTab} className="add-tab"/>
    <div className="window-controls"><SpringButton onClick={()=>window.browseryDesktop?.windowAction('minimize')} aria-label="Minimize"><Icon name="windowMin" size={14}/></SpringButton><SpringButton onClick={()=>window.browseryDesktop?.windowAction('maximize')} aria-label="Maximize"><Icon name="windowMax" size={13}/></SpringButton><SpringButton className="window-close" onClick={()=>window.browseryDesktop?.windowAction('close')} aria-label="Close Browsery"><Icon name="windowClose" size={14}/></SpringButton></div>
    {menu&&<div className="tab-menu-backdrop" aria-hidden="true" onPointerDown={()=>setMenu(null)}/>}
    <TabContextMenu menu={menu} groups={groups} onClose={()=>setMenu(null)} onPin={pinTab} onCloseTab={onCloseTab} onCloseOthers={onCloseOthers} onCloseRight={onCloseRight} onSetGroup={onSetGroup} onCreateGroup={onCreateGroup}/>
  </div>
}

function addressHost(value) { try { const url=new URL(value);return url.hostname||url.protocol.replace(':','') } catch { return value } }
function Omnibox({value,setValue,onGo,onAnalyze,suggestionsEnabled=true,engine,history=[],bookmarks=[]}) {
  const [focused,setFocused]=useState(false);
  const [selected,setSelected]=useState(-1);
  const suggestions=useMemo(()=>{
    const query=value.trim().toLowerCase();
    if(!query)return [];
    const visited=history.filter(item=>`${item.title} ${item.url}`.toLowerCase().includes(query)).slice(0,4).map(item=>({label:item.title||item.url,detail:addressHost(item.url),icon:'history',value:item.url}));
    const saved=bookmarks.filter(item=>`${item.title} ${item.url}`.toLowerCase().includes(query)&&!visited.some(match=>match.value===item.url)).slice(0,3).map(item=>({label:item.title||item.url,detail:addressHost(item.url),icon:'bookmark',value:item.url}));
    return [...visited,...saved,{label:`Search ${engine==='Browsery'?'Browsery':engine} for “${value.trim()}”`,detail:'Press Enter to search',icon:'search',value:value.trim()}].slice(0,6);
  },[value,history,bookmarks,engine]);
  const commit=item=>{setValue(item.value);setFocused(false);onGo(item.value)};
  const onKeyDown=event=>{
    if(event.key==='ArrowDown'&&suggestions.length){event.preventDefault();setSelected(index=>Math.min(index+1,suggestions.length-1));return}
    if(event.key==='ArrowUp'&&suggestions.length){event.preventDefault();setSelected(index=>Math.max(index-1,0));return}
    if(event.key==='Escape'){setFocused(false);return}
    if(event.key==='Enter'){event.preventDefault();suggestionsEnabled&&selected>=0?commit(suggestions[selected]):onGo()}
  };
  return <div className="omnibox-wrap" data-tour="omnibox">
    <div className={`omnibox ${focused?'focused':''}`}><Icon name="search" size={17}/><input role="combobox" aria-autocomplete="list" aria-expanded={focused&&suggestionsEnabled&&suggestions.length>0} aria-controls="omnibox-suggestions" aria-activedescendant={selected>=0?`omnibox-option-${selected}`:undefined} value={value} onChange={e=>{setValue(e.target.value);setSelected(-1)}} onFocus={()=>setFocused(true)} onBlur={()=>setTimeout(()=>setFocused(false),140)} onKeyDown={onKeyDown} placeholder={`Search ${engine==='Browsery'?'Browsery':engine} or enter a URL`} autoComplete="off"/><SpringButton type="button" className="omnibox-spark analyze-trigger" aria-label="Analyze with Groq" title="Analyze this page with Groq" onClick={onAnalyze}><Icon name="spark" size={17}/></SpringButton></div>
    {focused&&suggestionsEnabled&&suggestions.length>0&&<div className="suggestions" id="omnibox-suggestions" role="listbox">{suggestions.map((suggestion,index)=><SpringButton id={`omnibox-option-${index}`} role="option" aria-selected={selected===index} className={selected===index?'suggestion-selected':''} key={`${suggestion.icon}-${suggestion.value}`} onMouseDown={event=>event.preventDefault()} onClick={()=>commit(suggestion)}><Icon name={suggestion.icon} size={15}/><span><b>{suggestion.label}</b><small>{suggestion.detail}</small></span><kbd>↵</kbd></SpringButton>)}</div>}
  </div>
}

function Control({item,value,onChange}) {
  const [id,label,type,initial]=item; const v=value??initial;
  const tourTarget={ 'data-tour':`setting-${id}` };
  if(type==='toggle')return <label {...tourTarget} className="setting-row"><span>{label}</span><SpringButton className={`switch ${v?'on':''}`} onClick={()=>onChange(id,!v)} aria-label={label} aria-pressed={v}><i/></SpringButton></label>;
  if(type==='range')return <label {...tourTarget} className="setting-range"><span><b>{label}</b><em>{v}%</em></span><input type="range" min="0" max="100" value={v} style={{'--fill':`${v}%`}} onChange={e=>onChange(id,+e.target.value)}/></label>;
  if(type==='angle')return <label {...tourTarget} className="setting-range"><span><b>{label}</b><em>{v}°</em></span><input aria-label={label} type="range" min="-45" max="45" step="1" value={v} style={{'--fill':`${(v+45)/90*100}%`}} onChange={e=>onChange(id,+e.target.value)}/></label>;
  if(type==='color')return <label {...tourTarget} className="setting-row"><span>{label}</span><span className="color-input"><input type="color" value={v} onChange={e=>onChange(id,e.target.value)}/>{v}</span></label>;
  if(type==='text')return <label {...tourTarget} className="setting-row"><span>{label}</span><input className="setting-text" type="url" value={v} onChange={e=>onChange(id,e.target.value)} placeholder="https://example.com"/></label>;
  const opts={aa:['Off','FXAA','TAA'],fps:['30 FPS','60 FPS','120 FPS','144 FPS'],texture:['Low','Medium','High','Ultra'],dpr:['1×','1.5×','2×','Auto'],trail:['Dust','Ribbon','Comet'],corners:['Soft','Compact','Sharp'],trackers:['Standard','Balanced','Strict'],cookies:['On close','1 hour','24 hours','7 days'],tabs:['Horizontal','Vertical'],engine:[['Mojeek · Independent','Mojeek'],['Browsery · Custom','Browsery'],['DuckDuckGo','DuckDuckGo'],['Bing','Bing']],aiModel:[['GPT-OSS 120B · Groq','openai/gpt-oss-120b'],['GPT-OSS 20B · Groq','openai/gpt-oss-20b']],homepage:['New Space','Blank','Custom'],unloadAfter:['Never','5 minutes','10 minutes','30 minutes','1 hour'],path:['Downloads','Desktop','Ask every time'],theme:['Soft','Crystalline','Analog','Solar Wind'],accentPreset:[['Planetarium gold','Monochrome'],'Browsery Cyan','Ultraviolet','Solar Amber','Signal Green','Rose Quartz'],backgroundScene:['Original Saturn','Spatial overlay'],clockStyle:['24-hour','12-hour','Hidden'],chromeDensity:['Compact','Comfortable','Spacious'],cornerStyle:['Square','Rounded','Soft'],...{}};
  return <label {...tourTarget} className="setting-row"><span>{label}</span><select value={v} onChange={e=>onChange(id,e.target.value)}>{(opts[id]||[v,'Default']).map(option=>Array.isArray(option)?<option key={option[1]} value={option[1]}>{option[0]}</option>:<option key={option}>{option}</option>)}</select></label>;
}

function AiOverviewCredentials({open}) {
  const desktop=window.browseryDesktop;
  const [status,setStatus]=useState({loading:true,configured:false,encryptionAvailable:false});
  const [draft,setDraft]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),[editing,setEditing]=useState(false);
  useEffect(()=>{
    if(!open)return;let current=true;
    if(!desktop?.aiKeyStatus){setStatus({loading:false,configured:false,encryptionAvailable:false});return}
    desktop.aiKeyStatus().then(result=>{if(current)setStatus({loading:false,...result})}).catch(()=>{if(current)setStatus({loading:false,configured:false,encryptionAvailable:false})});
    return()=>{current=false};
  },[desktop,open]);
  const save=async()=>{
    if(busy||!draft.trim()||!desktop?.saveAiApiKey)return;setBusy(true);setMessage('');
    try{
      const result=await desktop.saveAiApiKey(draft.trim());
      if(!result?.ok){setMessage(result?.message||'Could not save the key.');return}
      // Read back the main-process status instead of assuming a successful save persisted.
      const verified=await desktop.aiKeyStatus();setStatus({loading:false,...verified});
      if(!verified.configured){setMessage('The key could not be read back. Please retry saving it.');return}
      setDraft('');setEditing(false);setMessage(result.message);
    }catch{setMessage('Could not securely save the key.')}finally{setBusy(false)}
  };
  const clear=async()=>{
    if(busy)return;setBusy(true);
    try{const result=await desktop?.clearAiApiKey?.();if(result?.ok){setStatus({loading:false,...await desktop.aiKeyStatus()});setDraft('');setEditing(false);setMessage('Saved key removed.')}else setMessage(result?.message||'Could not remove the saved key.')}catch{setMessage('Could not remove the saved key.')}finally{setBusy(false)}
  };
  const saved=status.configured&&!editing;
  return <section data-tour="groq-credentials" className="ai-key-card" aria-busy={busy||status.loading}>
    <div className="ai-key-heading"><span className="ai-provider-mark">G</span><div><b>Groq API</b><small>{status.loading?'Checking secure key storage…':status.configured?'One saved key for all Browsery AI features.':status.storageStatus==='unreadable'?'The saved key cannot be read. Replace it below.':'Save your key once on this device.'}</small></div></div>
    {saved?<div className="ai-saved-key" role="status"><span className="ai-saved-check">✓</span><div><b>Saved on this device</b><small>Encrypted · Restored automatically after restart</small><span>AI Overview + Analyze with Groq</span></div></div>:<><label className="ai-key-label" htmlFor="groq-api-key">{editing?'Replacement Groq API key':'Groq API key'}</label><input id="groq-api-key" className="ai-key-input" type="password" autoComplete="off" spellCheck="false" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="gsk_…" disabled={busy||status.loading||!status.encryptionAvailable}/></>}
    <div className="ai-key-actions">{saved?<SpringButton disabled={busy} onClick={()=>{setEditing(true);setMessage('')}}>Change key</SpringButton>:<SpringButton disabled={busy||!draft.trim()||!status.encryptionAvailable} onClick={save}>{busy?'Saving…':'Save key'}</SpringButton>}{editing&&status.configured&&<SpringButton disabled={busy} onClick={()=>{setDraft('');setEditing(false);setMessage('')}}>Cancel</SpringButton>}{status.stored&&<SpringButton disabled={busy} onClick={clear}>Remove key</SpringButton>}</div>
    <p>This key is shared by Browsery’s AI features on your device—not with other people. It stays outside the app folder and is not cleared when you close Settings, reset appearance, or update Browsery. Each recipient saves their own key. Groq usage follows your plan.</p>
    {message&&<small className="ai-key-message" role="status">{message}</small>}
    {!desktop&&<small className="ai-key-message">Key setup is available in the Browsery desktop app, not the web preview.</small>}
    {desktop&&!status.loading&&!status.encryptionAvailable&&<small className="ai-key-message">OS-backed secure storage is unavailable. The key was not saved.</small>}
  </section>;
}

function SettingsDrawer({open,onClose,values,setValues,onManageData,onManageProtection,onManagePersonal,onRunSetup,initialSection='graphics',focusSection,audioEngine,audioReady}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const [section,setSection]=useState(initialSection);
  useEffect(()=>{if(open)setSection(focusSection||initialSection)},[open,initialSection,focusSection]);
  const category=settingsSchema.find(s=>s.id===section); const change=(id,v)=>setValues(x=>({...x,[id]:v}));
  const resetSection=()=>setValues(current=>({...current,...Object.fromEntries(category.items.map(([id,,,value])=>[id,value]))}));
  const resetAll=()=>setValues(initialSettings);
  const total=settingsSchema.reduce((sum,item)=>sum+item.items.length,0);
  return <aside ref={panelRef} data-tour="settings-drawer" className={`drawer settings-drawer ${open?'open':''}`} aria-hidden={!open}>
    <nav className="settings-nav" aria-label="Settings categories">{settingsSchema.map(s=><SpringButton data-tour={`settings-${s.id}`} spring="fluid" hoverScale={1.025} pressScale={.98} className={section===s.id?'active':''} onClick={()=>setSection(s.id)} key={s.id}><Icon name={s.icon}/><span>{s.label}</span><em>{s.items.length}</em></SpringButton>)}</nav>
    <div className="drawer-head"><div><h2>Settings</h2></div><GlassButton icon="close" label="Close settings" onClick={onClose}/></div>
    <div className="settings-body"><div className="settings-content" key={section}><div className="settings-section-head"><h3>{category.label}</h3><span>{category.items.length} controls</span></div><div className="controls">{category.items.map(item=><Control key={item[0]} item={item} value={values[item[0]]} onChange={change}/>)}</div>{section==='sound'&&<div className="sound-preview-card"><span className={`sound-preview-indicator ${audioReady&&values.ambience&&values.ambienceVolume>0&&values.master>0&&values.ambience?'ready':''}`}><Icon name="volume" size={17}/></span><div><b>{values.ambience&&values.ambienceVolume>0&&values.master>0?'Space ambience enabled':'Space ambience paused'}</b><small>{audioReady?'Live, procedural audio · no download required':'Audio wakes on your first click or Preview'}</small></div><SpringButton disabled={values.master===0} onClick={()=>audioEngine.preview()}>Preview</SpringButton></div>}{section==='privacy'&&<><div className="privacy-data-link protection-settings-link"><span className="privacy-data-icon"><Icon name="shield" size={17}/></span><div><b>Protection dashboard</b><small>See blocked ads, tracker rules, and your site allowlist</small></div><SpringButton onClick={onManageProtection}><Icon name="chevron" size={16}/><span>Open</span></SpringButton></div><div className="privacy-data-link"><span className="privacy-data-icon"><Icon name="cookie" size={17}/></span><div><b>Cookies &amp; site data</b><small>Review cookies, storage, cache and history</small></div><SpringButton onClick={onManageData}><Icon name="chevron" size={16}/><span>Manage</span></SpringButton></div></>}{section==='browser'&&<><div className="privacy-data-link personal-settings-link"><span className="privacy-data-icon"><Icon name="shield" size={17}/></span><div><b>Personal browser</b><small>Manage encrypted saved logins, default-browser guidance, and safe update checks</small></div><SpringButton onClick={onManagePersonal}><Icon name="chevron" size={16}/><span>Manage</span></SpringButton></div>{onRunSetup&&<div data-tour="setup-wizard" className="privacy-data-link setup-settings-link"><span className="privacy-data-icon"><Icon name="reload" size={17}/></span><div><b>Setup wizard</b><small>Default browser, Groq API key and the quick tour, step by step</small></div><SpringButton onClick={onRunSetup}><Icon name="chevron" size={16}/><span>Run setup again</span></SpringButton></div>}</>}{section==='ai'&&<AiOverviewCredentials open={open}/>}</div></div>
    {section==='spatial'&&<div className="motion-preview"><div><b>Click energy · {values.motionStrength}%</b><small>{values.power?'Low-power mode is on':'Press. Pulse. Spring back.'}</small></div><SpringButton className="motion-preview-button" aria-label="Try click animation"><Icon name="spark" size={17}/> Try a click</SpringButton></div>}
    <div className="settings-dock" aria-label="Quick spatial settings"><SpringButton className={values.power?'active':''} onClick={()=>change('power',!values.power)} aria-pressed={values.power}><Icon name="spark"/><span>{values.power?'Low power':'Full motion'}</span></SpringButton><SpringButton className={values.refraction?'active':''} onClick={()=>change('refraction',!values.refraction)}><Icon name="grid"/><span>Depth</span></SpringButton><SpringButton className={values.cursorEnabled?'active':''} onClick={()=>change('cursorEnabled',!values.cursorEnabled)}><Icon name="sliders"/><span>Cursor</span></SpringButton><SpringButton onClick={resetAll}><Icon name="reload"/><span>Reset all</span></SpringButton></div>
    <div className="drawer-footer"><span>{total} settings · Changes save instantly</span><SpringButton onClick={resetSection}>Reset {category.label}</SpringButton></div>
  </aside>;
}

function AnalyzeDrawer({open,onClose,tab,result,onAnalyze}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const desktop=Boolean(window.browseryDesktop?.isDesktop);
  const status=result?.status||'idle';
  const messages={
    'missing-key':'Add your Groq API key in Settings → AI Overview, then try again.',
    'key-unreadable':'The saved Groq key could not be decrypted. Replace it in Settings → AI Overview.',
    'secure-storage-unavailable':'Secure credential storage is unavailable on this device, so Browsery cannot send your key safely.',
    'invalid-key':'Groq rejected the saved API key. Check it in Settings → AI Overview.',
    'usage-limit':'Groq’s usage limit was reached. Try again later or check your Groq plan.',
    'request-failed':'Groq could not analyze this page. Check your connection and try again.',
    timeout:'The analysis took too long. Try again.',
    'invalid-image':'Browsery could not capture this page. Reload it and try again.',
    'invalid-response':'Groq returned an unreadable analysis. Please retry.',
    'no-page':'Open a webpage before asking Groq to analyze it.',
    'page-loading':'This page is still loading. Wait a moment, then try again.',
    'desktop-only':'Screen analysis is available in the Browsery desktop app.',
  };
  const busy=status==='loading';
  return <aside ref={panelRef} className={`drawer analyze-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>Analyze with Groq</h2></div><GlassButton icon="close" label="Close page analysis" onClick={onClose}/></div>
    <div className="analysis-body">
      <div className="analysis-page-card"><span className="analysis-page-icon"><Icon name="globe" size={18}/></span><div><b>{tab?.title||'Current tab'}</b><small>{tab?.url?addressHost(tab.url):'No webpage open'}</small></div></div>
      <p className="analysis-intro">Find visible layout problems, clipped content, hard-to-read text, and broken-looking elements on this page.</p>
      {status==='ready'?<section className="analysis-result" aria-live="polite"><div className="analysis-summary"><span className={result.findings?.length?'has-issues':'no-issues'}><Icon name={result.findings?.length?'alert':'spark'} size={16}/></span><p>{result.summary|| (result.findings?.length?'I spotted a few things worth checking.':'Nothing obvious looks broken in this view.')}</p></div>{result.findings?.length?<div className="analysis-findings">{result.findings.map((finding,index)=><article className={`analysis-finding severity-${finding.severity}`} key={`${finding.title}-${index}`}><div><span>{finding.severity}</span><b>{finding.title}</b></div><p>{finding.evidence}</p>{finding.fix&&<small>Try: {finding.fix}</small>}</article>)}</div>:<div className="analysis-clear"><Icon name="spark" size={16}/><span>No clear visual issues found in the captured view.</span></div>}</section>:status==='loading'?<div className="analysis-status is-loading" role="status"><span className="analysis-spinner"/><div><b>Looking over the page…</b><small>Groq is checking the visible viewport.</small></div></div>:status==='idle'?<div className="analysis-status"><span className="analysis-status-icon"><Icon name="alert" size={16}/></span><div><b>Ready when you are</b><small>Open a page, then run a visual check.</small></div></div>:<div className="analysis-status analysis-error" role="status"><span className="analysis-status-icon"><Icon name="alert" size={16}/></span><div><b>Couldn’t finish the analysis</b><small>{messages[status]||'Please try again.'}</small></div></div>}
      {!desktop&&<p className="analysis-note">The screen-capture feature needs the Browsery desktop app.</p>}
      <SpringButton className="analysis-run" spring="snappy" disabled={busy||!desktop||!tab?.url} onClick={onAnalyze}><Icon name="spark" size={17}/><span>{busy?'Analyzing page…':status==='ready'?'Analyze again':'Analyze with Groq'}</span></SpringButton>
      <p className="analysis-privacy">Only runs when you click. Browsery sends a resized screenshot of the visible webpage to Groq for analysis; it does not save the screenshot. Avoid analyzing pages with private information.</p>
    </div>
  </aside>;
}

function DownloadDrawer({open,onClose,audioEngine}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const desktop=window.browseryDesktop; const [items,setItems]=useState([]);
  const completed=useRef(new Set());
  useEffect(()=>desktop?.onDownload(update=>{setItems(current=>{const exists=current.some(item=>item.id===update.id);return exists?current.map(item=>item.id===update.id?{...item,...update}:item):[{...update},...current]});if(update.state==='completed'&&!update.historical&&!completed.current.has(update.id)){completed.current.add(update.id);audioEngine.play('download')}}),[desktop,audioEngine]);
  const command=(item,action)=>desktop?.downloadCommand({id:item.id,action});
  const formatBytes=n=>n?`${(n/1048576).toFixed(n>104857600?0:1)} MB`:'—';
  const activeCount=items.filter(x=>x.state==='progressing').length; const totalSpeed=items.reduce((sum,x)=>sum+(x.speed||0),0);
  return <aside ref={panelRef} className={`drawer download-drawer ${open?'open':''}`}><div className="drawer-head"><div><h2>Downloads</h2></div><GlassButton icon="close" label="Close downloads" onClick={onClose}/></div>
    <div className="download-summary"><div><strong>{activeCount}</strong><span>active</span></div><i/><p><b>{(totalSpeed/1048576).toFixed(1)}</b> MB/s<br/><span>total speed</span></p></div>
    <div className="download-list">{items.length===0?<div className="empty-downloads"><Icon name="download" size={28}/><strong>No downloads yet</strong><span>Files you download from webpages will appear here.</span></div>:items.map(x=><article key={x.id} className="download-item"><div className="file-icon"><Icon name="folder"/></div><div className="file-info"><strong>{x.name}</strong><span>{formatBytes(x.total)} · {x.state==='completed'?'Complete':`${(x.speed/1048576).toFixed(1)} MB/s`}</span><div className="progress"><i style={{width:x.progress+'%'}}/></div><small>{x.progress}%</small></div><div className="file-actions">{x.state==='progressing'&&<><GlassButton icon={x.paused?'play':'pause'} label={x.paused?'Resume':'Pause'} onClick={()=>command(x,x.paused?'resume':'pause')}/><GlassButton icon="trash" label="Cancel download" onClick={()=>command(x,'cancel')}/></>}{x.state==='completed'&&<GlassButton icon="folder" label="Show in folder" onClick={()=>command(x,'open')}/>}</div></article>)}</div>
  </aside>;
}

function LibraryDrawer({open,onClose,title,items,onSelect,onRemove,onClear,historyMode=false}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const [filter,setFilter]=useState('');
  useEffect(()=>{if(open)setFilter('')},[open]);
  const visible=items.filter(item=>`${item.title||''} ${item.url||''}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return <aside ref={panelRef} className={`drawer library-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>{title}</h2></div><div className="library-head-actions">{historyMode&&items.length>0&&<SpringButton onClick={onClear}>Clear history</SpringButton>}<GlassButton icon="close" label={`Close ${title.toLowerCase()}`} onClick={onClose}/></div></div>
    <label className="library-filter"><Icon name="search" size={16}/><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} aria-label={`Search ${title.toLowerCase()}`}/></label>
    <div className="library-list">{visible.length===0?<div className="empty-downloads"><Icon name={historyMode?'history':'bookmark'} size={27}/><strong>{items.length?'No matches':'Nothing saved yet'}</strong><span>{items.length?'Try a different title or address.':historyMode?'Pages you visit will appear here.':'Save a page with the bookmark button or Ctrl+D.'}</span></div>:visible.map((item,index)=><article className="library-item" key={`${item.url}-${index}`}><button className="library-item-main" onClick={()=>onSelect(item.url)}><span className="library-favicon">{(item.title||item.url||'B').slice(0,1).toUpperCase()}</span><span className="library-item-copy"><b>{item.title||item.url}</b><small>{item.url}</small>{historyMode&&<em>{Number.isFinite(item.visitedAt)?new Date(item.visitedAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'Recently visited'}</em>}</span></button><GlassButton icon="trash" label={historyMode?'Remove from history':'Remove bookmark'} onClick={()=>onRemove(item.url)}/></article>)}</div>
  </aside>;
}

function BookmarkDrawer({open,onClose,items,folders,onOpen,onRemove,onMove,onCreateFolder,onImport}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const importRef=useRef(null);
  const [filter,setFilter]=useState(''),[folder,setFolder]=useState('All');
  const availableFolders=useMemo(()=>Array.from(new Set(['All',...folders,...items.map(item=>item.folder||'Favorites')])).filter(Boolean),[folders,items]);
  useEffect(()=>{if(open){setFilter('');setFolder(current=>availableFolders.includes(current)?current:'All')}},[open,availableFolders]);
  const visible=items.filter(item=>{
    const itemFolder=item.folder||'Favorites';
    const matchesFolder=folder==='All'||itemFolder===folder;
    return matchesFolder&&`${item.title||''} ${item.url||''}`.toLowerCase().includes(filter.trim().toLowerCase());
  });
  const createFolder=()=>{
    const requested=window.prompt('Name this bookmark folder');
    const name=String(requested||'').trim().slice(0,42);
    if(!name)return;
    onCreateFolder(name);setFolder(name);
  };
  const exportBookmarks=()=>{
    const data=JSON.stringify({browsery:'bookmarks',version:1,exportedAt:new Date().toISOString(),folders,bookmarks:items},null,2);
    const blob=new Blob([data],{type:'application/json'}),href=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=href;link.download=`browsery-bookmarks-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  const importFile=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    let text='';try{text=await file.text()}catch{return}
    let imported=[];
    try {
      const parsed=JSON.parse(text),source=Array.isArray(parsed)?parsed:(Array.isArray(parsed.bookmarks)?parsed.bookmarks:[]);
      imported=source.map(item=>({url:normalizeShortcut(item?.url),title:String(item?.title||'').trim().slice(0,140),folder:String(item?.folder||'Imported').trim().slice(0,42)||'Imported'})).filter(item=>item.url);
    } catch {
      const parser=new DOMParser();
      for(const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
        const url=normalizeShortcut(match[1]);
        if(url)imported.push({url,title:parser.parseFromString(match[2],'text/html').body.textContent?.trim().slice(0,140)||addressHost(url),folder:'Imported'});
      }
    }
    if(imported.length)onImport(imported);
    else window.alert('No usable bookmarks were found in that file. Choose a Browsery JSON backup or a standard HTML bookmarks export.');
  };
  return <aside ref={panelRef} className={`drawer library-drawer bookmark-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>Bookmarks</h2></div><div className="library-head-actions"><SpringButton onClick={createFolder}><Icon name="folderPlus" size={14}/>New folder</SpringButton><GlassButton icon="close" label="Close bookmarks" onClick={onClose}/></div></div>
    <div className="bookmark-toolbar"><label className="library-filter"><Icon name="search" size={16}/><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Search bookmarks" aria-label="Search bookmarks"/></label><div className="bookmark-transfer"><SpringButton onClick={()=>importRef.current?.click()}><Icon name="import" size={14}/>Import</SpringButton><SpringButton onClick={exportBookmarks} disabled={!items.length}><Icon name="export" size={14}/>Export</SpringButton><input ref={importRef} className="bookmark-import-input" type="file" accept="application/json,text/html,.json,.html,.htm" onChange={importFile}/></div></div>
    <div className="bookmark-folders" role="tablist" aria-label="Bookmark folders">{availableFolders.map(name=><SpringButton key={name} role="tab" aria-selected={folder===name} className={folder===name?'active':''} onClick={()=>setFolder(name)}><Icon name={name==='All'?'grid':'folder'} size={14}/><span>{name}</span><em>{name==='All'?items.length:items.filter(item=>(item.folder||'Favorites')===name).length}</em></SpringButton>)}</div>
    <div className="library-list bookmark-list">{visible.length===0?<div className="empty-downloads"><Icon name="bookmark" size={27}/><strong>{items.length?'No matching bookmarks':'No bookmarks in this folder'}</strong><span>{items.length?'Try another folder or phrase.':'Save a page with Ctrl+D, then keep it organized here.'}</span></div>:visible.map((item,index)=><article className="library-item bookmark-item" key={`${item.url}-${index}`}><button className="library-item-main" onClick={()=>onOpen(item.url)}><Favicon className="library-favicon" url={item.url} title={item.title} favicon={item.favicon}/><span className="library-item-copy"><b>{item.title||item.url}</b><small>{item.url}</small></span></button><select value={item.folder||'Favorites'} aria-label={`Folder for ${item.title||item.url}`} onChange={event=>onMove(item.url,event.target.value)}>{availableFolders.filter(name=>name!=='All').map(name=><option key={name}>{name}</option>)}</select><GlassButton icon="trash" label="Remove bookmark" onClick={()=>onRemove(item.url)}/></article>)}</div>
  </aside>;
}

function BrowserDataDrawer({open,onClose,history,onClearHistory}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const desktop=window.browseryDesktop;
  const [partition,setPartition]=useState('regular');
  const [cookies,setCookies]=useState([]);
  const [filter,setFilter]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    if(!desktop?.listBrowserCookies){setCookies([]);setMessage('Browser data is available in the installed desktop app.');return}
    setLoading(true);
    try{setCookies(await desktop.listBrowserCookies(partition));setMessage('')}
    catch{setMessage('Could not read this profile’s browser data.')}
    finally{setLoading(false)}
  },[desktop,partition]);
  useEffect(()=>{if(open){setFilter('');refresh()}},[open,refresh]);
  const removeCookie=async cookie=>{
    setBusy(true);
    try{const result=await desktop?.removeBrowserCookie?.({...cookie,partition});if(result?.removed){setCookies(current=>current.filter(item=>!(item.name===cookie.name&&item.domain===cookie.domain&&item.path===cookie.path)));setMessage(`Removed ${cookie.name}.`)}else setMessage('That cookie was already removed.')}
    catch{setMessage('Could not remove this cookie. Refresh and try again.')}
    finally{setBusy(false)}
  };
  const clearType=async(type,label)=>{
    if(!window.confirm(`Clear ${label.toLowerCase()} for the ${partition==='private'?'private':'regular'} Browsery profile? This can sign you out of websites.`))return;
    setBusy(true);setMessage('');
    try{const result=await desktop?.clearBrowserData?.({partition,types:[type]});if(!result?.ok)throw new Error('Clear failed');if(type==='cookies')setCookies([]);setMessage(`${label} cleared.`)}
    catch{setMessage(`Could not clear ${label.toLowerCase()}.`)}
    finally{setBusy(false)}
  };
  const clearAll=async()=>{
    const profile=partition==='private'?'private':'regular';
    if(!window.confirm(`Clear cookies, site storage, cached files and web authentication for the ${profile} profile${profile==='regular'?'? Browsery history will also be cleared.':'?'} This can sign you out of websites.`))return;
    setBusy(true);setMessage('');
    try{const result=await desktop?.clearBrowserData?.({partition,types:['cookies','siteData','cache','auth']});if(!result?.ok)throw new Error('Clear failed');setCookies([]);if(partition==='regular')onClearHistory();setMessage('All browsing data cleared. Bookmarks and Browsery settings were kept.')}
    catch{setMessage('Could not clear all browser data. Try the individual controls.')}
    finally{setBusy(false)}
  };
  const visible=cookies.filter(cookie=>`${cookie.name} ${cookie.domain} ${cookie.sameSite}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const formatExpiry=cookie=>cookie.session?'Session':cookie.expirationDate?new Date(cookie.expirationDate*1000).toLocaleDateString(): 'Session';
  return <aside ref={panelRef} className={`drawer browser-data-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>Browser data</h2></div><GlassButton icon="close" label="Close browser data" onClick={onClose}/></div>
    <div className="browser-data-body">
      <label className="data-profile-select"><span>Profile</span><select value={partition} onChange={event=>setPartition(event.target.value)}><option value="regular">Regular · saved on this PC</option><option value="private">Private · temporary</option></select></label>
      <section className="data-section cookie-section"><div className="data-section-head"><div><span className="data-section-icon"><Icon name="cookie" size={17}/></span><div><h3>Cookies</h3><p>{loading?'Loading cookies…':`${cookies.length} stored · values never shown`}</p></div></div><SpringButton className="data-refresh" onClick={refresh} disabled={loading||busy}><Icon name="reload" size={14}/><span>Refresh</span></SpringButton></div>
        <label className="data-filter"><Icon name="search" size={15}/><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Find a site or cookie" aria-label="Find cookies by site or name"/></label>
        <div className="cookie-list" aria-live="polite">{loading?<div className="data-empty">Reading the browser’s cookie store…</div>:visible.length===0?<div className="data-empty">{cookies.length?'No cookies match that search.':'No cookies stored in this profile yet.'}</div>:visible.map((cookie,index)=><article className="cookie-row" key={`${cookie.domain}|${cookie.path}|${cookie.name}`} style={{'--row-index':index}}><span className="cookie-site-mark"><Icon name="globe" size={15}/></span><div className="cookie-copy"><strong title={cookie.name}>{cookie.name}</strong><span title={cookie.domain}>{cookie.domain||'Local site'}{cookie.path!=='/'?cookie.path:''}</span><small>{[cookie.secure?'Secure':null,cookie.httpOnly?'HttpOnly':null,cookie.sameSite!=='unspecified'?`SameSite ${cookie.sameSite}`:null,formatExpiry(cookie)].filter(Boolean).join(' · ')}</small></div><SpringButton className="cookie-remove" onClick={()=>removeCookie(cookie)} disabled={busy}>Remove</SpringButton></article>)}</div>
      </section>
      <section className="data-section data-actions-section"><div className="data-section-head"><div><span className="data-section-icon"><Icon name="database" size={17}/></span><div><h3>Site data &amp; cache</h3><p>Clear stored website data from this profile</p></div></div></div>
        <div className="data-action-list"><button onClick={()=>clearType('siteData','Site storage')} disabled={busy}><span><b>Site storage</b><small>Local data, service workers and offline files</small></span><Icon name="trash" size={15}/></button><button onClick={()=>clearType('cache','Cached files')} disabled={busy}><span><b>Cached files</b><small>Images and page resources stored for speed</small></span><Icon name="trash" size={15}/></button><button onClick={()=>clearType('auth','Saved web authentication')} disabled={busy}><span><b>Web authentication</b><small>HTTP authentication sessions for this profile</small></span><Icon name="trash" size={15}/></button></div>
      </section>
      <section className="data-section data-actions-section"><div className="data-section-head"><div><span className="data-section-icon"><Icon name="history" size={17}/></span><div><h3>Browsing history</h3><p>{partition==='regular'?`${history.length} recent pages stored on this PC`:'Private pages are not saved to history'}</p></div></div></div>
        <div className="history-clear-row"><span>Page titles and visit times</span><SpringButton onClick={()=>{if(partition==='private'){setMessage('Private browsing history is never saved.');return}if(window.confirm('Clear Browsery browsing history stored on this PC?')){onClearHistory();setMessage('Browsing history cleared.')}}} disabled={busy||partition==='private'||history.length===0}>Clear history</SpringButton></div>
      </section>
      <SpringButton className="data-clear-all" onClick={clearAll} disabled={busy}>Clear all browsing data for this profile</SpringButton>
      {message&&<div className="data-message" role="status">{message}</div>}
      <p className="data-privacy-note">Cookie values are never displayed here. Clearing cookies or site storage may sign you out or reset website preferences. Browsery settings and bookmarks are kept.</p>
    </div>
  </aside>;
}

function ProtectionDrawer({open,onClose,tab,onOpenSettings}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const desktop=window.browseryDesktop;
  const host=useMemo(()=>{
    try { const parsed=new URL(tab?.url||''); return /^https?:$/.test(parsed.protocol)?parsed.hostname:''; }
    catch { return ''; }
  },[tab?.url]);
  const [status,setStatus]=useState({loading:true,enabled:false,adblockEnabled:false,trackerMode:'Standard',blockedCount:0,adsBlocked:0,trackersBlocked:0,allowlisted:false,allowlistCount:0});
  const [sites,setSites]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const refresh=useCallback(async()=>{
    if(!desktop?.getProtectionStatus){setStatus(current=>({...current,loading:false,unavailable:true}));setSites([]);return}
    try {
      const [next,list]=await Promise.all([desktop.getProtectionStatus(host),desktop.listProtectionAllowedSites?.()]);
      setStatus({loading:false,...next});
      setSites(Array.isArray(list?.sites)?list.sites:[]);
    } catch { setStatus(current=>({...current,loading:false,error:true})); }
  },[desktop,host]);
  useEffect(()=>{if(!open)return;setMessage('');refresh();const timer=window.setInterval(refresh,2500);return()=>window.clearInterval(timer)},[open,refresh]);
  const changeSite=async action=>{
    if(!host||busy)return;
    const invoke=action==='allow'?desktop?.allowProtectionForSite:desktop?.removeProtectionForSite;
    if(!invoke)return;
    setBusy(true);setMessage('');
    try { const result=await invoke(host);setMessage(result?.ok?(action==='allow'?`Protection paused for ${host}.`:`Protection restored for ${host}.`):(result?.message||'Could not update this site.'));await refresh(); }
    catch { setMessage('Could not update this site.'); }
    finally { setBusy(false); }
  };
  const removeSite=async site=>{
    if(busy||!desktop?.removeProtectionForSite)return;
    setBusy(true);setMessage('');
    try { const result=await desktop.removeProtectionForSite(site);setMessage(result?.ok?`Protection restored for ${site}.`:(result?.message||'Could not update this site.'));await refresh(); }
    catch { setMessage('Could not update this site.'); }
    finally { setBusy(false); }
  };
  const reset=async()=>{
    if(busy||!desktop?.resetProtectionStats)return;
    setBusy(true);setMessage('');
    try { const result=await desktop.resetProtectionStats();if(result?.ok){setStatus(current=>({loading:false,...current,...result}));setMessage('Protection counters reset.');}else setMessage('Could not reset counters.'); }
    catch { setMessage('Could not reset counters.'); }
    finally { setBusy(false); }
  };
  const refreshRules=async()=>{
    if(busy||!desktop?.refreshProtectionRules)return;
    setBusy(true);setMessage('Checking Browsery protection definitions…');
    try {
      const result=await desktop.refreshProtectionRules();
      if(result?.rules)setStatus({loading:false,...result});
      const detail=result?.rules?.version?`Definitions ${result.rules.version} are ready.`:result?.message||'Browsery kept its current local definitions.';
      setMessage(result?.ok?detail:result?.message||'Browsery could not fetch an update, so current local definitions stay active.');
    } catch { setMessage('Browsery could not fetch an update, so current local definitions stay active.'); }
    finally { setBusy(false); }
  };
  const currentPage=host||'the new-tab page';
  const protectionSummary=status.loading?'Reading Browsery’s local protection state.':status.allowlisted?`${host} is on your allowlist.`:!status.enabled?'Turn on ad blocking or select Balanced / Strict tracker protection.':status.adblockEnabled?`Blocking ads and ${status.trackerMode.toLowerCase()} tracker traffic.`:`Blocking ${status.trackerMode.toLowerCase()} tracker traffic.`;
  return <aside ref={panelRef} className={`drawer protection-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>Privacy shield</h2></div><GlassButton icon="close" label="Close privacy shield" onClick={onClose}/></div>
    <div className="protection-body" aria-busy={status.loading||busy}>
      <section className={`protection-hero ${status.enabled?'is-active':'is-paused'}`}><span className="protection-hero-icon"><Icon name="shield" size={25}/></span><div><b>{status.loading?'Checking protection…':status.enabled?'Shield active':'Shield paused'}</b><small>{protectionSummary}</small></div><strong>{status.loading?'—':status.blockedCount}</strong></section>
      <section className="protection-stats" aria-label="Protection totals"><article><b>{status.loading?'—':status.adsBlocked}</b><span>ads blocked</span></article><article><b>{status.loading?'—':status.trackersBlocked}</b><span>trackers blocked</span></article><article><b>{status.loading?'—':status.allowlistCount}</b><span>allowed sites</span></article></section>
      <section className="protection-card"><div><b>Current site</b><small>{currentPage}</small></div>{host?<SpringButton className="protection-site-action" disabled={busy||status.loading} onClick={()=>changeSite(status.allowlisted?'remove':'allow')}><span>{status.allowlisted?'Restore protection':'Allow this site'}</span><Icon name={status.allowlisted?'shield':'close'} size={15}/></SpringButton>:<span className="protection-muted">Open a webpage to manage a site.</span>}</section>
      <section className="protection-card protection-mode"><div><b>Filtering mode</b><small>{status.adblockEnabled?'Ads blocked':'Ad blocking off'} · {status.trackerMode} trackers</small></div><SpringButton className="protection-site-action" onClick={onOpenSettings}><span>Privacy settings</span><Icon name="chevron" size={15}/></SpringButton></section>
      <section className="protection-card protection-rules"><div><b>Rule definitions</b><small>{status.rules?.source||'Local Browsery definitions'}{status.rules?.version?` · ${status.rules.version}`:''}</small></div><SpringButton className="protection-site-action" disabled={busy||status.loading} onClick={refreshRules}><span>{busy?'Checking…':'Refresh rules'}</span><Icon name="reload" size={15}/></SpringButton></section>
      <section className="protection-allowlist"><div className="protection-section-head"><div><b>Site allowlist</b><small>{sites.length?'Protection is paused only on these sites.':'No sites are allowed through.'}</small></div>{status.blockedCount>0&&<SpringButton className="protection-reset" disabled={busy} onClick={reset}>Reset totals</SpringButton>}</div><div className="protection-site-list">{sites.length?sites.map(site=><article key={site}><span><Icon name="globe" size={15}/></span><b>{site}</b><SpringButton aria-label={`Restore protection for ${site}`} disabled={busy} onClick={()=>removeSite(site)}><Icon name="close" size={14}/></SpringButton></article>):<div className="protection-empty"><Icon name="shield" size={18}/><span>Your protection rules apply everywhere.</span></div>}</div></section>
      {message&&<p className="protection-message" role="status">{message}</p>}
      <p className="protection-note">Browsery blocks common advertising and tracking subresources locally. It checks the official Browsery release channel for updated rule definitions, but never runs downloaded extension code or sends your browsing history to that channel.</p>
    </div>
  </aside>;
}

function PermissionPrompt({request,onDecision}) {
  const [remember,setRemember]=useState(false);
  useEffect(()=>setRemember(false),[request?.id]);
  if(!request)return null;
  const label=request.label||request.permission||'this feature';
  return <div className="permission-layer" role="presentation">
    <section className="permission-card" role="alertdialog" aria-modal="true" aria-labelledby="browsery-permission-title" aria-describedby="browsery-permission-copy">
      <span className="permission-mark"><Icon name="shield" size={20}/></span>
      <div className="permission-copy"><span>Website permission</span><h2 id="browsery-permission-title">Allow {label}?</h2><p id="browsery-permission-copy"><b>{request.origin}</b> wants to use {label}. Only allow this when you trust the site.</p></div>
      {!request.private&&<label className="permission-remember"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/><span>Remember for this site</span></label>}
      {request.private&&<p className="permission-private">Private sessions do not save permission decisions.</p>}
      <div className="permission-actions"><button type="button" className="permission-block" onClick={()=>onDecision('block',false)}>Block</button><button type="button" className="permission-allow" onClick={()=>onDecision('allow',remember)}>Allow</button></div>
    </section>
  </div>;
}

function FindBar({open,onClose,onFind,count=0,active=0}) {
  const [query,setQuery]=useState('');
  const input=useRef(null);
  useEffect(()=>{if(open){input.current?.focus();input.current?.select()}else{setQuery('');onFind('')}},[open]);
  if(!open)return null;
  return <div className="find-bar" role="search"><Icon name="find" size={16}/><input ref={input} value={query} onChange={event=>{setQuery(event.target.value);onFind(event.target.value)}} onKeyDown={event=>{if(event.key==='Escape')onClose();if(event.key==='Enter')onFind(query,true)}} placeholder="Find in page" aria-label="Find in page"/><span className="find-count">{query?`${active||0} / ${count||0}`:'Enter text'}</span><GlassButton icon="close" label="Close find" onClick={onClose}/></div>;
}

function VpnPanel({open,onClose,onOpenGuide}) {
  const panelRef=useSpringPresence(open,{preset:'fluid',offset:90});
  const isMac=window.browseryDesktop?.platform==='darwin';
  const [message,setMessage]=useState(''),[busy,setBusy]=useState('');
  const [proton,setProton]=useState({loading:true,installed:false,canConnect:false});
  const mounted=useRef(false),inFlight=useRef(false);
  const getProtonStatus=window.browseryDesktop?.getProtonStatus;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  useEffect(()=>{
    if(!open)return;let current=true;
    setMessage('');setProton(previous=>({...previous,loading:true}));
    if(isMac){setProton({loading:false,installed:false,canConnect:false});return}
    if(!getProtonStatus){setProton({loading:false,installed:false,canConnect:false,unavailable:true,message:'Proton controls are available in the Browsery desktop app.'});return}
    // Check once when this panel opens; installation is not a live tunnel-status indicator.
    Promise.resolve().then(()=>getProtonStatus()).then(result=>{
      if(current)setProton({loading:false,installed:Boolean(result?.installed),canConnect:Boolean(result?.installed&&result?.canConnect),version:typeof result?.version==='string'?result.version:'',message:typeof result?.message==='string'?result.message:''});
    }).catch(()=>{if(current)setProton({loading:false,installed:false,canConnect:false,unavailable:true,message:'Could not check Proton. Open its Windows app directly, or try reopening this panel.'})});
    return()=>{current=false};
  },[open,getProtonStatus,isMac]);
  const runAction=async action=>{
    if(isMac){setMessage('Open Proton’s macOS app yourself, then sign in and use Quick Connect. Browsery does not control Proton on macOS.');return}
    if(inFlight.current||(action==='connect'&&(!proton.canConnect||proton.loading)))return;
    const desktop=window.browseryDesktop;
    const invoke=action==='connect'?desktop?.connectProton:action==='open'?desktop?.openProton:desktop?.openVpnSettings;
    if(!invoke){setMessage(action==='settings'?'Open Windows Settings → Network & internet → VPN.':'Open Proton’s Windows app directly. These controls require the updated Browsery desktop app.');return}
    inFlight.current=true;setBusy(action);setMessage('');
    try{
      const result=await invoke();
      if(mounted.current)setMessage(result?.message||(result?.ok?(action==='connect'?'Connect request sent to Proton. Check its app to confirm the connection.':action==='open'?'Proton opened. Sign in there, then connect.':'Windows VPN Settings opened. Connect there, then return to Browsery.'):'The request could not complete. Open Proton directly and try there.'));
    }catch{if(mounted.current)setMessage(action==='settings'?'Open Windows Settings → Network & internet → VPN.':'Proton could not open or accept the request. Open its Windows app directly and sign in there.')}finally{inFlight.current=false;if(mounted.current)setBusy('')}
  };
  return <aside ref={panelRef} className={`drawer vpn-drawer ${open?'open':''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><h2>Use Proton VPN</h2></div><GlassButton icon="close" label="Close VPN" onClick={onClose}/></div>
    <div className="vpn-setup-body" aria-busy={Boolean(busy)||proton.loading}>
      <div className="vpn-setup-mark"><Icon name="shield" size={34}/></div>
      <h3>Connect with Proton.</h3><p>{isMac?'Connect in Proton’s macOS app manually. Browsery cannot open or control it on macOS. This is a system VPN—not a Browsery-only tunnel.':'Use Proton’s installed Windows app from here. This is a system VPN—not a Browsery-only tunnel. Browsery follows it unless split tunneling excludes Browsery.'}</p>
      <div className="vpn-honest-state" role="status"><i/><div><b>{isMac?'Manual setup on macOS':proton.loading?'Checking Proton installation…':proton.unavailable?'Could not check Proton':proton.installed?'Proton VPN is installed':'Proton VPN not found'}</b><span>{isMac?'Browsery does not detect Proton’s installation or verify VPN status on macOS. Sign in and connect in Proton’s own app.':<>{proton.version?`Version ${proton.version} · `:''}{proton.message|| (proton.installed?'Proton confirms the connection in its own app. Browsery does not verify tunnel status.':'Install Proton’s official Windows app, then reopen this panel.')}</>}</span></div></div>
      <div className="vpn-proton-actions">
        {isMac?<SpringButton className="vpn-proton-guide" onClick={onOpenGuide}><Icon name="shield" size={18}/><span>Get Proton VPN for macOS</span><Icon name="forward" size={17}/></SpringButton>:<>
          {proton.installed&&proton.canConnect&&<SpringButton className="vpn-proton-guide" disabled={Boolean(busy)||proton.loading} onClick={()=>runAction('connect')}><Icon name="shield" size={18}/><span>{busy==='connect'?'Requesting connection…':'Connect Proton'}</span><Icon name="forward" size={17}/></SpringButton>}
          {proton.installed?<SpringButton className="vpn-open-settings" disabled={Boolean(busy)||proton.loading} onClick={()=>runAction('open')}><Icon name="globe" size={18}/><span>{busy==='open'?'Opening Proton…':'Open Proton'}</span><Icon name="forward" size={17}/></SpringButton>:!proton.loading&&<SpringButton className="vpn-proton-guide" onClick={onOpenGuide}><Icon name="shield" size={18}/><span>Get Proton VPN for Windows</span><Icon name="forward" size={17}/></SpringButton>}
        </>}
      </div>
      {message&&<div className="vpn-setup-message" role="status">{message}</div>}
      <ol className="vpn-setup-steps">
        <li><span>01</span><div><b>Sign in inside Proton</b><p>Install the official {isMac?'macOS':'Windows'} app if needed. Browsery never asks for your Proton password.</p></div></li>
        <li><span>02</span><div><b>{isMac?'Connect in Proton':'Request a connection'}</b><p>{isMac?'Open Proton’s macOS app yourself, sign in, and use Quick Connect.':proton.canConnect?'Click Connect Proton here. If Proton asks you to sign in or approve anything, finish that in its app.':'Open Proton and click Connect in its app. This version cannot accept a Connect request from Browsery.'} Wait for Proton itself to confirm the connection.</p></div></li>
        <li><span>03</span><div><b>{isMac?'Return to Browsery':'Keep Browsery in the tunnel'}</b><p>{isMac?'Once Proton confirms the VPN connection, browse normally here. Browsery does not display a verified tunnel status.':'Leave split tunneling off, or make sure Browsery is not excluded. Then browse normally here.'}</p></div></li>
      </ol>
      {!isMac&&<details className="vpn-manual"><summary>Other manual VPN configurations</summary><p>Windows’ built-in VPN form needs a compatible provider profile. Import WireGuard .conf files into the official WireGuard app instead.</p><SpringButton className="vpn-open-settings" disabled={Boolean(busy)} onClick={()=>runAction('settings')}><Icon name="settings" size={16}/><span>{busy==='settings'?'Opening settings…':'Open Windows VPN Settings'}</span></SpringButton></details>}
      <p className="vpn-setup-note">Keep VPN passwords and private keys in the provider’s app. Never paste them into chat or Groq.</p>
    </div>
  </aside>;
}

function Toast({message}) { return <div className={`toast ${message?'show':''}`}><Icon name="spark" size={16}/>{message}</div> }

function LocalMusicPlayer({compact=false}) {
  const inputRef=useRef(null),audioRef=useRef(null),objectUrl=useRef(null);
  const [track,setTrack]=useState(null),[playing,setPlaying]=useState(false),[progress,setProgress]=useState(0),[duration,setDuration]=useState(0);
  useEffect(()=>()=>{if(objectUrl.current)URL.revokeObjectURL(objectUrl.current)},[]);
  const choose=()=>inputRef.current?.click();
  const load=event=>{const file=event.target.files?.[0];if(!file)return;if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);const url=URL.createObjectURL(file);objectUrl.current=url;setTrack({name:file.name.replace(/\.[^.]+$/,''),url});setProgress(0);setDuration(0);requestAnimationFrame(()=>audioRef.current?.play().catch(()=>{}));};
  const toggle=()=>{const audio=audioRef.current;if(!audio)return;if(audio.paused)audio.play().catch(()=>{});else audio.pause()};
  const seek=event=>{const audio=audioRef.current;if(!audio||!duration)return;audio.currentTime=Number(event.target.value);setProgress(audio.currentTime)};
  return <section className={`local-music-player ${compact?'is-compact':''} ${playing?'is-playing':''}`} aria-label="Ad-free local music player">
    <audio ref={audioRef} src={track?.url} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onLoadedMetadata={e=>setDuration(e.currentTarget.duration||0)} onTimeUpdate={e=>setProgress(e.currentTarget.currentTime||0)}/>
    <input ref={inputRef} className="music-file-input" type="file" accept="audio/*" onChange={load}/>
    <button className="music-art" onClick={choose} aria-label="Choose a music file"><Icon name="music" size={20}/></button>
    <div className="music-copy"><b>{track?.name||'Your local music'}</b><span>{track?'Playing from this device · no ads':'Choose an audio file · no ads'}</span></div>
    <div className="music-wave" aria-hidden="true">{Array.from({length:18},(_,index)=><i key={index} style={{'--wave':`${24+(index*37)%68}%`}}/>)}</div>
    <div className="music-controls"><button onClick={choose} aria-label="Choose track"><Icon name="previous" size={15}/></button><button className="music-play" onClick={toggle} aria-label={playing?'Pause music':'Play music'}><Icon name={playing?'pause':'play'} size={16}/></button><button onClick={choose} aria-label="Choose another track"><Icon name="next" size={15}/></button></div>
    {track&&<input className="music-progress" type="range" min="0" max={Math.max(duration,1)} step="0.1" value={Math.min(progress,duration||0)} onChange={seek} aria-label="Music progress"/>}
  </section>;
}

function MusicDrawer({open,onClose}) { const panelRef=useSpringPresence(open,{preset:'fluid',offset:90}); return <aside ref={panelRef} className={`drawer music-drawer ${open?'open':''}`} aria-hidden={!open}><div className="drawer-head"><div><h2>Music</h2></div><GlassButton icon="close" label="Close music" onClick={onClose}/></div><div className="music-drawer-body"><LocalMusicPlayer/><p>Your files stay on this device. Browsery does not use a streaming service, ads, or an account for this player.</p></div></aside> }

function normalizeShortcut(raw) {
  const candidate=String(raw||'').trim();
  if(!candidate)return '';
  const withProtocol=/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)?candidate:`https://${candidate}`;
  try { const parsed=new URL(withProtocol);return /^https?:$/.test(parsed.protocol)?parsed.href:''; } catch { return ''; }
}

function ShortcutDock({shortcuts,onOpen,onUpdate}) {
  const addShortcut=()=>{
    const raw=window.prompt('Website address for this shortcut');
    if(raw===null)return;
    const url=normalizeShortcut(raw);
    if(!url){window.alert('Enter a valid http or https website address.');return}
    const suggested=addressHost(url).replace(/^www\./,'');
    const label=window.prompt('Shortcut name',suggested);
    if(label===null)return;
    onUpdate([...shortcuts,{id:`shortcut-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,url,label:label.trim()||suggested,color:'#c8d8e7'}]);
  };
  const editShortcut=shortcut=>{
    const label=window.prompt('Shortcut name',shortcut.label||addressHost(shortcut.url));
    if(label===null)return;
    const raw=window.prompt('Website address — leave blank to remove this shortcut',shortcut.url);
    if(raw===null)return;
    if(!raw.trim()){onUpdate(shortcuts.filter(item=>item.id!==shortcut.id));return}
    const url=normalizeShortcut(raw);
    if(!url){window.alert('Enter a valid http or https website address.');return}
    onUpdate(shortcuts.map(item=>item.id===shortcut.id?{...item,url,label:label.trim()||addressHost(url)}:item));
  };
  return <div className="favorites spatial-shortcut-dock" aria-label="Homepage shortcuts">{shortcuts.map((shortcut,index)=><div className="favorite-entry" key={shortcut.id}><SpringButton onClick={()=>onOpen(shortcut.url)} onContextMenu={event=>{event.preventDefault();editShortcut(shortcut)}} className="favorite" style={{'--accent':shortcut.color||'#c8d8e7','--dock-index':index}} hoverScale={1.06} pressScale={.94} title={shortcut.url}><span><Favicon url={shortcut.url} title={shortcut.label}/></span><b>{shortcut.label||addressHost(shortcut.url)}</b></SpringButton><button type="button" className="shortcut-edit" onClick={()=>editShortcut(shortcut)} aria-label={`Edit ${shortcut.label||'shortcut'}`}><Icon name="more" size={14}/></button></div>)}<SpringButton onClick={addShortcut} className="favorite shortcut-add" hoverScale={1.05} pressScale={.94} title="Add homepage shortcut"><span><Icon name="plus" size={22}/></span><b>Add</b></SpringButton></div>;
}

// "Thursday 15 October": weekday, day and month names in the user's language, without commas.
function newTabDate(date) {
  try {
    const parts=Object.fromEntries(new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long'}).formatToParts(date).map(part=>[part.type,part.value]));
    return [parts.weekday,parts.day,parts.month].filter(Boolean).join(' ');
  } catch { return date.toDateString(); }
}

function NewTab({onSearch, onOpenMusic, settings, pointer, shortcuts=defaultShortcuts, onUpdateShortcuts, musicEnabled=true}) {
  const [query,setQuery]=useState(''); const [time,setTime]=useState('10:09'); const [dateLabel,setDateLabel]=useState('');
  const videoRef=useRef(null),tiltState=useRef({frame:0,rect:null,x:0,y:0});
  useEffect(()=>{
    // The clock shows minutes, so wake once per minute (aligned to the minute) instead of every second.
    let timer=0;const f=()=>{const now=new Date();setTime(now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:settings.clockStyle==='12-hour'}));setDateLabel(newTabDate(now));timer=setTimeout(f,60000-Date.now()%60000+50)};f();return()=>clearTimeout(timer)},[settings.clockStyle]);
  useEffect(()=>{if(videoRef.current)videoRef.current.playbackRate=.5+(settings.videoSpeed??50)/100},[settings.videoSpeed]);
  useEffect(()=>{const video=videoRef.current;if(!video)return;const visibility=()=>{if(document.hidden)video.pause();else video.play().catch(()=>{})};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility)},[]);
  useEffect(()=>()=>{if(tiltState.current.frame)cancelAnimationFrame(tiltState.current.frame)},[]);
  const tilt=useCallback(e=>{
    if(settings.power||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const el=e.currentTarget,s=tiltState.current;s.rect??=el.getBoundingClientRect();s.x=e.clientX;s.y=e.clientY;
    if(s.frame)return;s.frame=requestAnimationFrame(()=>{s.frame=0;const r=s.rect;if(!r)return;const max=(settings.tilt||0)/5;el.style.setProperty('--rx',`${3-(s.y-r.top-r.height/2)/r.height*max}deg`);el.style.setProperty('--ry',`${-10+(s.x-r.left-r.width/2)/r.width*max*1.2}deg`)});
  },[settings.tilt,settings.power]);
  return <main className="new-tab">
    <video ref={videoRef} className="saturn-video" style={{'--saturn-tilt':`${saturnTiltAngle(settings.saturnTilt)}deg`}} src="./assets/saturn-loop.mp4" poster="./assets/saturn-poster.jpg" autoPlay muted loop playsInline preload="metadata"/>
    {settings.backgroundScene==='Spatial overlay'?<><WebGLScene pointer={pointer} settings={settings}/><div className="spatial-grid"/></>:null}
    {settings.clockStyle!=='Hidden'&&<header className="time-block new-tab-clock"><time>{time}</time><p>{dateLabel}</p></header>}
    <section className="new-tab-center spatial-rig" onPointerEnter={e=>{tiltState.current.rect=e.currentTarget.getBoundingClientRect()}} onPointerMove={tilt} onPointerLeave={e=>{const s=tiltState.current;if(s.frame)cancelAnimationFrame(s.frame);s.frame=0;s.rect=null;e.currentTarget.style.setProperty('--rx','3deg');e.currentTarget.style.setProperty('--ry','-10deg')}}>
      <div className="command-plane">
        <form className="home-search" onSubmit={e=>{e.preventDefault();onSearch(query)}}><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${settings.engine==='Browsery'?'Browsery':settings.engine} or enter an address`}/><SpringButton aria-label="Search"><Icon name="forward"/></SpringButton></form>
      </div>
      {settings.showFavorites && (
        <ShortcutDock shortcuts={shortcuts} onOpen={onSearch} onUpdate={onUpdateShortcuts}/>
      )}
    </section>
    {musicEnabled&&<div className="new-tab-music"><LocalMusicPlayer compact/></div>}
  </main>;
}

function BrowserTabContents({tab,active,onSearch,onOpenMusic,onPageUpdate,onFindUpdate,settings,pointer,register,shortcuts,onUpdateShortcuts,musicEnabled=true,extensionHost,unloaded=false,onBlocked}) {
  const webviewRef=useRef(null),source=useRef(tab.url),mountAddress=useRef(tab.url),isDesktop=Boolean(window.browseryDesktop?.isDesktop);
  const [loadError,setLoadError]=useState(false);
  const [safetyAlert,setSafetyAlert]=useState(null);
  const bypassSafety=useRef('');
  const [pageReady,setPageReady]=useState(false);
  const guest=useRef(null),visibility=useRef({active,muted:settings.mutetabs});
  visibility.current={active,muted:settings.mutetabs};
  const privateMode=useRef(settings.private);
  if(privateMode.current!==settings.private){source.current=tab.url;mountAddress.current=tab.url;privateMode.current=settings.private}
  if(!tab.url){source.current=null;mountAddress.current=null}else if(!source.current){source.current=tab.url;mountAddress.current=tab.url}
  const [hasBeenActive,setHasBeenActive]=useState(Boolean(active&&tab.url));
  useEffect(()=>{if(active&&tab.url)setHasBeenActive(true)},[active,Boolean(tab.url)]);
  const shouldLoad=Boolean(tab.url)&&(active||(hasBeenActive&&!unloaded));
  // An unloaded tab reopens at the page it was last on, not the address it was first opened with.
  if(!shouldLoad&&tab.url)mountAddress.current=tab.url;
  useEffect(()=>setLoadError(false),[tab.url]);
  useEffect(()=>{
    // Electron exposes these methods before the guest exists. Only call them after dom-ready.
    if(!guest.current?.ready)return;
    try{guest.current.view.setAudioMuted(!active&&Boolean(settings.mutetabs))}catch{}
  },[active,settings.mutetabs,shouldLoad]);
  useEffect(()=>{
    const view=webviewRef.current;if(!view||!shouldLoad||!isDesktop)return;
    const controller={view,ready:false,pendingUrl:null};guest.current=controller;register(tab.id,controller);extensionHost?.attach(tab.id,controller);
    const currentUrl=()=>{try{return controller.ready?view.getURL():source.current}catch{return source.current}};
    const ready=()=>{
      controller.ready=true;
      try{view.setAudioMuted(!visibility.current.active&&Boolean(visibility.current.muted))}catch{}
      // Tell Electron which guest is foregrounded. The native layer uses this
      // to enable/disable Chromium background throttling for sleeping tabs.
      try{const webContentsId=view.getWebContentsId?.();if(Number.isSafeInteger(webContentsId))window.browseryDesktop?.updateTabActivity?.({webContentsId,active:Boolean(visibility.current.active)}).catch(()=>{})}catch{}
      if(controller.pendingUrl){const target=controller.pendingUrl;controller.pendingUrl=null;view.loadURL(target).catch(()=>{});return}
      setPageReady(true);
      // Run installed extensions (Night Shift, cookie pop-ups, zoom memory…) on each loaded page.
      Promise.resolve(extensionHost?.pageReady(tab.id,controller,currentUrl())).catch(()=>{});
    };
    const nav=event=>{const nextUrl=event.url||currentUrl();const blocked=extensionHost?.checkNavigation(nextUrl);if(blocked){onBlocked?.(blocked);try{if(view.canGoBack())view.goBack();else view.loadURL('about:blank')}catch{}return}if(nextUrl)source.current=nextUrl;try{const webContentsId=view.getWebContentsId?.();if(nextUrl&&Number.isSafeInteger(webContentsId))window.browseryDesktop?.predictivePreload?.({webContentsId,url:nextUrl}).catch(()=>{})}catch{}setSafetyAlert(null);setLoadError(false);onPageUpdate(tab.id,{url:nextUrl})};
    const guard=event=>{const nextUrl=event.url;const blocked=extensionHost?.checkNavigation(nextUrl);if(blocked){try{view.stop()}catch{}onBlocked?.(blocked);onPageUpdate(tab.id,{loading:false});return}if(bypassSafety.current===nextUrl){bypassSafety.current='';return}const reason=settings.phishing?suspiciousUrl(nextUrl):null;if(reason){event.preventDefault();try{view.stop()}catch{}setSafetyAlert({url:nextUrl,reason});onPageUpdate(tab.id,{loading:false});}};
    const title=event=>onPageUpdate(tab.id,{title:event.title,currentUrl:currentUrl()});
    const favicon=event=>{const icon=Array.isArray(event.favicons)?event.favicons.find(value=>/^https?:/i.test(value)):'';if(icon)onPageUpdate(tab.id,{favicon:icon,currentUrl:currentUrl()});};
    const start=()=>{setLoadError(false);setPageReady(false);onPageUpdate(tab.id,{loading:true})};
    const stop=()=>{const address=currentUrl();if(address)source.current=address;if(controller.ready)setPageReady(true);onPageUpdate(tab.id,{loading:false,...(address?{url:address}:{})})};
    const fail=event=>{if(event.isMainFrame&&event.errorCode!==-3){setLoadError(true);setPageReady(true)}};
    const found=event=>{if(visibility.current.active)onFindUpdate?.({matches:event.matches||0,active:event.activeMatchOrdinal||0})};
    view.addEventListener('dom-ready',ready);view.addEventListener('will-navigate',guard);view.addEventListener('did-navigate',nav);view.addEventListener('did-navigate-in-page',nav);view.addEventListener('page-title-updated',title);view.addEventListener('page-favicon-updated',favicon);view.addEventListener('did-start-loading',start);view.addEventListener('did-stop-loading',stop);view.addEventListener('did-fail-load',fail);view.addEventListener('found-in-page',found);
    return()=>{controller.ready=false;guest.current=null;register(tab.id,null);extensionHost?.detach(tab.id);view.removeEventListener('dom-ready',ready);view.removeEventListener('will-navigate',guard);view.removeEventListener('did-navigate',nav);view.removeEventListener('did-navigate-in-page',nav);view.removeEventListener('page-title-updated',title);view.removeEventListener('page-favicon-updated',favicon);view.removeEventListener('did-start-loading',start);view.removeEventListener('did-stop-loading',stop);view.removeEventListener('did-fail-load',fail);view.removeEventListener('found-in-page',found)};
  },[tab.id,shouldLoad,settings.private,settings.phishing,isDesktop,onPageUpdate,onFindUpdate,register,extensionHost,onBlocked]);
  useEffect(()=>{
    if(!isDesktop||!shouldLoad)return;
    const view=guest.current?.view;
    try{const webContentsId=view?.getWebContentsId?.();if(Number.isSafeInteger(webContentsId))window.browseryDesktop?.updateTabActivity?.({webContentsId,active:Boolean(active)}).catch(()=>{})}catch{}
  },[active,isDesktop,shouldLoad]);
  if(!tab.url)return <div className={`browser-tab-surface ${active?'is-active':''}`} style={{display:active?'flex':'none'}}>{active?<NewTab onSearch={onSearch} onOpenMusic={onOpenMusic} settings={settings} pointer={pointer} shortcuts={shortcuts} onUpdateShortcuts={onUpdateShortcuts} musicEnabled={musicEnabled}/>:null}</div>;
  if(!shouldLoad)return <div className="browser-tab-surface" style={{display:'none'}} aria-hidden="true"/>;
  let failedQuery='';try{failedQuery=new URL(tab.url).searchParams.get('q')||''}catch{}
  return <div className={`browser-tab-surface ${active?'is-active':''}`} style={{display:active?'flex':'none'}} aria-hidden={!active}>{isDesktop?<webview ref={webviewRef} key={`${tab.id}-${settings.private?'private':'normal'}`} src={mountAddress.current} partition={settings.private?'browsery-private':'persist:browsery'} webpreferences="contextIsolation=yes,sandbox=yes"/>:<iframe title={tab.title} src={tab.url} />}{isDesktop&&!pageReady&&!loadError&&!safetyAlert&&<div className="browser-load-state" role="status"><span className="browser-load-orbit"/><h2>{tab.url?.startsWith('browsery:')?'Opening Browsery Search…':'Opening page…'}</h2><p>{failedQuery||addressHost(tab.url)}</p></div>}{safetyAlert&&<div className="browser-safety-alert" role="alert"><span><Icon name="shield" size={25}/></span><h2>Browsery paused this link</h2><p>{safetyAlert.reason} Browsery has not loaded the page.</p><small>Local phishing checks are not antivirus protection. Groq can explain a page after it is opened, but does not decide this warning.</small><div><SpringButton onClick={()=>{bypassSafety.current=safetyAlert.url;setSafetyAlert(null);webviewRef.current?.loadURL?.(safetyAlert.url).catch(()=>{})}}>Open anyway</SpringButton><SpringButton onClick={()=>onSearch('')}>Return to search</SpringButton></div></div>}{loadError&&<div className="browser-load-error" role="alert"><span className="browser-load-error-icon"><Icon name="alert" size={19}/></span><h2>{tab.url?.startsWith('browsery:')?'Browsery Search did not load':'This page did not load'}</h2><p>The page request failed before Browsery received any content. Your tabs and saved browser data are unchanged.</p><div><SpringButton onClick={()=>onSearch(tab.url)}>Retry</SpringButton>{failedQuery&&<SpringButton onClick={()=>onSearch(`https://www.bing.com/search?q=${encodeURIComponent(failedQuery)}`)}>Try another search source</SpringButton>}</div></div>}</div>;
}

const BrowserViewport=React.forwardRef(function BrowserViewport({tabs,active,onSearch,onOpenMusic,onPageUpdate,onFindUpdate,settings,pointer,shortcuts,onUpdateShortcuts,musicEnabled=true,extensionHost,unloadedTabs,onBlocked},ref){
  const views=useRef(new Map());
  const register=useCallback((id,view)=>{if(view)views.current.set(id,view);else views.current.delete(id)},[]);
  React.useImperativeHandle(ref,()=>{
    const current=()=>views.current.get(active);
    const invoke=(method,...args)=>{const guest=current();if(!guest?.ready)return;try{return guest.view[method]?.(...args)}catch{return undefined}};
    return {
      back:()=>invoke('canGoBack')&&invoke('goBack'),forward:()=>invoke('canGoForward')&&invoke('goForward'),
      reload:()=>invoke('reload'),stop:()=>invoke('stop'),navigate:address=>{const guest=current();if(!guest)return;if(!guest.ready){guest.pendingUrl=address;return}invoke('loadURL',address)?.catch(()=>{})},
      getWebContentsId:()=>invoke('getWebContentsId')||null,
      find:(text,next=false)=>text?invoke('findInPage',text,{forward:true,findNext:next}):invoke('stopFindInPage','clearSelection'),
      zoom:step=>{if(!current()?.ready)return null;const factor=invoke('getZoomFactor')||1;if(step==='read')return Math.round(factor*100);const next=step===0?1:Math.max(.5,Math.min(2,factor+step));invoke('setZoomFactor',next);return Math.round(next*100)},
    };
  },[active]);
  return <div className="browser-page browser-viewport-stack">{tabs.map(tab=><BrowserTabContents key={tab.id} tab={tab} active={tab.id===active} onSearch={onSearch} onOpenMusic={onOpenMusic} onPageUpdate={onPageUpdate} onFindUpdate={onFindUpdate} settings={settings} pointer={pointer} register={register} shortcuts={shortcuts} onUpdateShortcuts={onUpdateShortcuts} musicEnabled={musicEnabled} extensionHost={extensionHost} unloaded={unloadedTabs?.has(tab.id)} onBlocked={onBlocked}/>)}</div>;
});

const settingTourDetails = Object.freeze({
  gpu:'Uses the graphics pipeline for Browsery’s spatial shell.', particles:'Sets the amount of visual cursor and scene detail.', aa:'Chooses the smoothing mode for the spatial scene.', fps:'Sets the target refresh cap for Browsery’s animated scene.', depth:'Changes how far panels lift in the spatial stage.', power:'Reduces nonessential visual motion to conserve resources.', texture:'Sets the quality level for Browsery-owned scene textures.', shadows:'Shows or hides dynamic depth shadows in the shell.', bloom:'Sets the strength of bright-edge glow.', dpr:'Sets the pixel-density ceiling for Browsery-owned visuals.',
  blur:'Adjusts blur behind Browsery panels.', glow:'Sets the shell highlight color.', opacity:'Sets panel transparency.', tilt:'Sets pointer-based panel tilt.', speed:'Scales nonessential Browsery motion.', motionStrength:'Sets the press and release motion response.', trail:'Chooses the cursor-trail style.', refraction:'Enables or removes glass refraction effects.', parallax:'Enables or removes the spatial background offset.', shards:'Shows or hides the decorative floating shards.', corners:'Chooses the compactness of spatial panel corners.',
  adblock:'Enables Browsery’s built-in network blocking rules.', trackers:'Sets the tracker-blocking level.', https:'Upgrades eligible pages to HTTPS before loading.', phishing:'Checks destinations against Browsery’s local suspicious-link guard.', dnt:'Sends a Global Privacy Control preference where supported.', cookies:'Sets when Browsery purges cookie data.', private:'Opens browsing in Browsery’s private session partition.', doh:'Uses encrypted DNS resolution for Browsery requests.', fingerprint:'Applies Browsery’s fingerprint-reduction preferences.', webrtc:'Limits WebRTC address exposure.', telemetry:'Controls Browsery’s optional anonymous telemetry setting.',
  tabs:'Switches between horizontal and vertical tab layouts.', engine:'Chooses the default source for omnibox searches.', homepage:'Chooses what the Home button opens.', homepageUrl:'Sets the address used when Custom homepage is selected.', path:'Chooses where Browsery places downloads.', suggestions:'Shows or hides local history and bookmark suggestions.', sleep:'Allows inactive tabs to be suspended when Browsery decides they are idle.', restore:'Restores the last Browsery session after restart.', preload:'Allows Browsery to warm up likely navigation targets.', compact:'Tightens tab spacing.', closewarn:'Shows a confirmation before Browsery closes when needed.',
  aiOverview:'Enables the opt-in Groq overview on Browsery search pages.', aiModel:'Chooses the Groq model used for Browsery AI features.',
  ambience:'Turns the optional procedural space ambience on or off.', ambienceVolume:'Sets the ambience volume.', clicks:'Turns Browsery click sounds on or off.', hover:'Turns hover feedback on or off.', master:'Sets Browsery audio volume.', visualizer:'Shows or hides the audio visualizer.', mutetabs:'Mutes background-tab audio when enabled.', startup:'Turns the Browsery startup sound on or off.', downloadtone:'Turns download-complete sound on or off.', haptic:'Sets Browsery’s visual/haptic response strength.', theme:'Chooses the Browsery sound character.', spatialaudio:'Turns the spatial audio field on or off.',
  accentPreset:'Applies a Browsery color preset.', systemContrast:'Allows Browsery to respect the Windows contrast preference.', backgroundScene:'Chooses the new-tab background treatment.', saturnTilt:'Rotates the Saturn composition.', backgroundBrightness:'Sets the Saturn video brightness.', backgroundContrast:'Sets the Saturn video contrast.', videoSpeed:'Sets the Saturn video playback speed.', clockStyle:'Chooses the new-tab clock format.', showFavorites:'Shows or hides the shortcut dock.', chromeDensity:'Changes toolbar and tab spacing.', cornerStyle:'Chooses Browsery panel corner styling.', fontScale:'Scales Browsery interface text and shell controls.', cursorEnabled:'Shows or hides Browsery’s optional cursor trail.', cursorSize:'Sets the cursor-trail size.',
});

const settingTourAction = Object.freeze({
  toggle:'Use the switch to choose its state.', range:'Drag the slider to choose a value.', angle:'Drag the slider to set the angle.', color:'Choose a color with the color picker.', text:'Enter the destination address here.', select:'Choose an option from the menu.',
});

const settingsWalkthroughSteps = settingsSchema.flatMap(category => [
  {id:`settings-${category.id}`,title:`${category.label} settings`,body:`Browsery has ${category.items.length} ${category.label.toLowerCase()} controls. The next steps spotlight each one; the tour never changes a setting for you.`,target:`[data-tour="settings-${category.id}"]`,panel:'settings',section:category.id,kind:'category'},
  ...category.items.map(([id,label,type])=>({
    id:`setting-${id}`,
    title:label,
    body:`${settingTourDetails[id]||`Controls ${label.toLowerCase()} in Browsery.`} ${settingTourAction[type]||'Choose the value you prefer.'} Your choice is not changed by this tour.`,
    target:`[data-tour="setting-${id}"]`,
    panel:'settings',
    section:category.id,
    kind:'setting',
  })),
]);

const ownerGuideRoutes = Object.freeze([
  { id:'search', label:'Search & tabs' },
  { id:'extensions', label:'Extensions' },
  { id:'settings', label:'Settings' },
  { id:'privacy', label:'Protection' },
  { id:'groq-setup', label:'Groq setup' },
  { id:'vpn', label:'Proton VPN' },
]);

const ownerSettingsRoutes = Object.freeze(settingsSchema.map(({id,label,items})=>({id,label,count:items.length})));

const presentationSteps = [
  {id:'welcome',title:'Your Browsery owner guide',body:'No hunting through icons. This short guide opens the real feature panels, then lets you stay there and use them. Pick an area below or go step by step.',target:null,routes:ownerGuideRoutes},
  {id:'tabs',title:'Tabs and workspaces',body:'The top strip is where you create, close, switch, pin, group, and reorder tabs. Right-click a tab for its workspace actions.',target:'[data-tour="tabs"]'},
  {id:'search',title:'Search, URLs and navigation',body:'Type a website address or a question here. Back, forward, reload, and Home sit immediately to its left.',target:'[data-tour="omnibox"]'},
  {id:'library',title:'Bookmarks, history and closed tabs',body:'This grid button opens Bookmarks. The clock button is History and includes recently closed tabs; the magnifier finds text on the page.',target:'.bookmark-drawer',panel:'bookmarks',actionLabel:'Use Bookmarks'},
  {id:'extensions',title:'Extensions are here',body:'Extensions are the third icon in the first tools group. The store has 20 built-in tools, like Reader View, Night Shift, Focus Mode and Element Zapper. They ship with Browsery, so nothing is downloaded from the web.',target:'.extensions-drawer',panel:'extensions',actionLabel:'Use Extensions'},
  {id:'downloads',title:'Downloads, in one place',body:'The download arrow opens live transfers. Pause, cancel, open, and reveal files from this panel. You can also press Ctrl+J.',target:'.download-drawer',panel:'downloads',actionLabel:'Use Downloads'},
  {id:'privacy',title:'Protection and site data',body:'The shield opens Browsery’s protection dashboard. Cookies and site data are in the button directly beside it, so you can review or clear them without searching.',target:'.protection-drawer',panel:'protection',actionLabel:'Open Protection'},
  {id:'vpn',title:'Proton VPN',body:'The VPN button opens Browsery’s Proton connection panel. It can launch the Proton app or send you to the official setup when Proton needs attention.',target:'.vpn-drawer',panel:'vpn',actionLabel:'Open Proton VPN'},
  {id:'groq-setup',title:'Set up Groq once',body:'Your Groq key belongs in Settings → AI Overview. It is stored securely on this device and powers both short search overviews and the two Groq tools.',target:'[data-tour="groq-credentials"]',panel:'settings',section:'ai',actionLabel:'Set up Groq'},
  {id:'voice',title:'Hey Groq voice assistant',body:'Start a voice session only when you want it, then say “Hey Groq” and a question. Browsery can show the answer and read it aloud; it never starts listening by itself.',target:'.voice-assistant-drawer',panel:'voice',actionLabel:'Use Hey Groq'},
  {id:'analyze',title:'Analyze a page with Groq',body:'Analyze with Groq checks the currently visible page for layout issues and gives a short written result. It is a visual helper, not antivirus protection.',target:'.analyze-drawer',panel:'analyze',actionLabel:'Open Analyze'},
  {id:'music',title:'Your ad-free music player',body:'Music plays files you choose from your computer. There is no account, streaming service, or advertising in this player.',target:'.music-drawer',panel:'music',actionLabel:'Open Music'},
  {id:'settings',title:'Every setting has a home',body:'The gear opens the control room. Choose any category below to jump directly to its real controls—there is no 89-screen setting slideshow anymore.',target:'.settings-drawer',panel:'settings',section:'graphics',actionLabel:'Open Settings',settingsRoutes:ownerSettingsRoutes},
  {id:'space',title:'Your personal start space',body:'The Saturn new tab is where your shortcuts, clock, local music player, and visual controls come together. It stays visual here and out of the way on normal websites.',target:'.new-tab-center'},
  {id:'finish',title:'You know where everything is',body:'Use the ? at the far right any time to replay this owner guide. It never changes a setting by itself; “Use it” always leaves the real panel open for you.',target:null},
];

function TutorialOverlay({open,stepIndex,onClose,onNext,onBack,onJump,onOpenFeature}) {
  const [rect,setRect]=useState(null);
  const cardRef=useRef(null);
  const restoreFocusRef=useRef(null);
  const step=presentationSteps[stepIndex]||presentationSteps[0];
  useEffect(()=>{
    if(!open)return undefined;
    restoreFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const timer=requestAnimationFrame(()=>cardRef.current?.querySelector('[data-tour-primary]')?.focus());
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return}
      if(event.key!=='Tab')return;
      const focusable=[...cardRef.current?.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')||[]].filter(element=>!element.hasAttribute('hidden'));
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(!cardRef.current?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    document.addEventListener('keydown',onKeyDown,true);
    return()=>{cancelAnimationFrame(timer);document.removeEventListener('keydown',onKeyDown,true);const previous=restoreFocusRef.current;if(previous?.isConnected)previous.focus()};
  },[open,onClose,stepIndex]);
  useEffect(()=>{
    if(!open){setRect(null);return undefined}
    let settleTimer=0;
    const update=()=>{
      const element=step.target?document.querySelector(step.target):null;
      if(step.kind==='setting'&&element)element.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      const bounds=element?.getBoundingClientRect?.();
      if(!bounds){setRect(null);return}
      setRect({left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height});
    };
    const frame=requestAnimationFrame(()=>requestAnimationFrame(update));
    settleTimer=setTimeout(update,250);
    addEventListener('resize',update);addEventListener('scroll',update,true);
    return()=>{cancelAnimationFrame(frame);clearTimeout(settleTimer);removeEventListener('resize',update);removeEventListener('scroll',update,true)};
  },[open,step.target,stepIndex,step.kind]);
  if(!open)return null;
  const isLast=stepIndex===presentationSteps.length-1;
  return <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="browsery-tour-title" aria-describedby="browsery-tour-description">
    <div className={`tour-dim ${rect?'':'tour-dim-full'}`}/>
    {rect&&<div className="tour-spotlight" style={{left:rect.left-10,top:rect.top-10,width:rect.width+20,height:rect.height+20}}/>}
    <section ref={cardRef} tabIndex="-1" className={`tour-card ${rect?'has-target':'is-intro'} ${step.panel?'tour-feature-step':''}`}>
      <div className="tour-progress"><span>Step {stepIndex+1} of {presentationSteps.length}</span><button type="button" onClick={onClose}>Close guide</button></div>
      <span className="tour-kicker">Owner guide</span>
      <h2 id="browsery-tour-title" aria-live="polite">{step.title}</h2>
      <p id="browsery-tour-description">{step.body}</p>
      {step.routes&&<div className="tour-route-grid" aria-label="Jump to a Browsery area">{step.routes.map(route=><button type="button" className="tour-route" onClick={()=>onJump(route.id)} key={route.id}><span>{route.label}</span><Icon name="forward" size={14}/></button>)}</div>}
      {step.settingsRoutes&&<div className="tour-settings-grid" aria-label="Open a settings category">{step.settingsRoutes.map(route=><button type="button" className="tour-settings-link" onClick={()=>onOpenFeature('settings',route.id)} key={route.id}><span>{route.label}</span><small>{route.count} controls</small></button>)}</div>}
      <div className="tour-actions"><button type="button" className="tour-back" onClick={onBack} disabled={stepIndex===0}>Back</button>{step.panel&&<button type="button" className="tour-open" onClick={()=>onOpenFeature(step.panel,step.section)}>{step.actionLabel||'Use it now'}</button>}<button data-tour-primary type="button" className="tour-next" onClick={onNext}>{isLast?'Finish':'Next'} <Icon name="forward" size={15}/></button></div>
    </section>
  </div>;
}

function readList(key) { try { const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.url==='string'):[] } catch { return [] } }
function readNamedList(key,fallback=[]) { try { const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim()):fallback } catch { return fallback } }
function readTabGroups() { try { const value=JSON.parse(localStorage.getItem('browsery:tab-groups')||'[]');return Array.isArray(value)?value.filter(group=>group&&typeof group.id==='string'&&typeof group.name==='string').map(group=>({id:group.id,name:group.name.slice(0,42),color:/^#[0-9a-f]{6}$/i.test(group.color||'')?group.color:'#7fd7ef'})):[] } catch { return [] } }
function readShortcuts() { try { const raw=localStorage.getItem('browsery:shortcuts');if(raw===null)return defaultShortcuts;const value=JSON.parse(raw);return Array.isArray(value)?value.map(item=>({id:String(item?.id||''),label:String(item?.label||'').slice(0,32),url:normalizeShortcut(item?.url),color:/^#[0-9a-f]{6}$/i.test(item?.color||'')?item.color:'#c8d8e7'})).filter(item=>item.id&&item.url):defaultShortcuts; } catch { return defaultShortcuts; } }
function normalizeTab(tab) { return {id:tab?.id,title:String(tab?.title||'New Space').slice(0,180),url:typeof tab?.url==='string'?tab.url:null,loading:Boolean(tab?.loading),favicon:typeof tab?.favicon==='string'?tab.favicon:'',pinned:Boolean(tab?.pinned),groupId:typeof tab?.groupId==='string'?tab.groupId:null}; }
function versionIsOlder(current, minimum) { const parse=value=>String(value||'').match(/\d+/g)?.map(Number)||[];const a=parse(current),b=parse(minimum);if(!a.length||!b.length)return false;for(let index=0;index<Math.max(a.length,b.length);index+=1){const left=a[index]||0,right=b[index]||0;if(left!==right)return left<right}return false; }
function App() {
  const pointer=useRef({x:0,y:0}),browserRef=useRef(null),nextTabId=useRef(2),analysisRun=useRef(0),forcedUpdateVersionChecked=useRef('');
  const [launchComplete,setLaunchComplete]=useState(false);
  const [accountStatus,setAccountStatus]=useState({loading:true,account:null,error:''});
  const [session]=useState(()=>{try{return JSON.parse(localStorage.getItem('browsery:session')||'{}')}catch{return {}}});
  const [tabs,setTabs]=useState(()=>Array.isArray(session.tabs)&&session.tabs.length?session.tabs.map(normalizeTab):[normalizeTab({id:1,title:'New Space',url:null})]);
  const [active,setActive]=useState(()=>session.active||1);
  const [url,setUrl]=useState(''),[panel,setPanel]=useState(null),[toast,setToast]=useState(''),[theme,setTheme]=useState('dark');
  const [appUpdate,setAppUpdate]=useState({status:'idle',available:false,downloaded:false,progress:0,message:''});
  const [history,setHistory]=useState(()=>readList('browsery:history')),[bookmarks,setBookmarks]=useState(()=>readList('browsery:bookmarks'));
  const [closedTabs,setClosedTabs]=useState(()=>readList('browsery:closed-tabs').map(normalizeTab).slice(0,24));
  const [tabGroups,setTabGroups]=useState(readTabGroups);
  const [bookmarkFolders,setBookmarkFolders]=useState(()=>Array.from(new Set(['Favorites',...readNamedList('browsery:bookmark-folders')])));
  const [shortcuts,setShortcuts]=useState(readShortcuts);
  const [findOpen,setFindOpen]=useState(false),[findCounts,setFindCounts]=useState({matches:0,active:0}),[zoomPercent,setZoomPercent]=useState(100);
  const [screenAnalysis,setScreenAnalysis]=useState({status:'idle'});
  const [permissionRequest,setPermissionRequest]=useState(null);
  const [localControlState,setLocalControlState]=useState({online:false,mode:'active',message:'',announcements:[]});
  const [ownerControlReady,setOwnerControlReady]=useState(false);
  const remoteFeatures=localControlState.policy?.features||{};
  const forcedVersionRequired=Boolean(localControlState.policy?.minimumVersion&&versionIsOlder(appUpdate.currentVersion,localControlState.policy.minimumVersion));
  const [dismissedAnnouncement,setDismissedAnnouncement]=useState('');
  const [settings,setSettings]=useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem('browsery:settings')||'{}');
      const allowedEngines=['Browsery','Mojeek','DuckDuckGo','Bing'];
      const requestedEngine=['Mozilla Firefox','Google'].includes(saved.engine)?'Browsery':saved.engine;
      const oldModel=['gpt-6-luna','gpt-6.1-sol'].includes(saved.aiModel);
      const tunedMotion=saved.motionProfileVersion!==1?{...saved,fps:saved.fps==='120 FPS'?'60 FPS':saved.fps,particles:saved.particles===72?48:saved.particles,motionProfileVersion:1}:saved;
      const tunedSearch=saved.searchEngineProfileVersion!==1?{...tunedMotion,engine:requestedEngine==='Mojeek'?'Browsery':requestedEngine,searchEngineProfileVersion:1}:tunedMotion;
      return {...initialSettings,...migrateAppearance(tunedSearch),tabs:['Horizontal','Vertical'].includes(saved.tabs)?saved.tabs:'Horizontal',aiModel:oldModel?'openai/gpt-oss-120b':(saved.aiModel||initialSettings.aiModel),engine:allowedEngines.includes(tunedSearch.engine)?tunedSearch.engine:'Browsery'};
    } catch { return {...initialSettings,appearanceProfileVersion:1}; }
  });
  const [tourOpen,setTourOpen]=useState(()=>localStorage.getItem('browsery:tutorial-complete-v3')!=='1');
  const [setupOpen,setSetupOpen]=useState(false);
  const [supportUnread,setSupportUnread]=useState(0);
  const [tourStep,setTourStep]=useState(0);
  const [tourSection,setTourSection]=useState(null);
  const {audioEngine,audioReady}=useBrowseryAudio(settings);
  useClickFeedback(settings);
  const activeTab=tabs.find(t=>t.id===active)||tabs[0];
  const activeTabHasPage=Boolean(activeTab?.url);
  const [extensionHost]=useState(()=>createExtensionHost());
  useEffect(()=>()=>extensionHost.dispose(),[extensionHost]);
  useEffect(()=>{extensionHost.setActive({tabId:active,url:activeTab?.url||'',title:activeTab?.title||''})},[extensionHost,active,activeTab?.url,activeTab?.title]);
  // Memory saver: background tabs left alone long enough are unloaded (their
  // page process is closed) and reload when you return. Pinned tabs, tabs
  // playing sound and auto-refreshing tabs are never unloaded.
  const [unloadedTabs,setUnloadedTabs]=useState(()=>new Set());
  const lastSeen=useRef(new Map()),previousActive=useRef(active),tabsRef=useRef(tabs);
  tabsRef.current=tabs;
  useEffect(()=>{
    const now=Date.now();
    lastSeen.current.set(previousActive.current,now);lastSeen.current.set(active,now);previousActive.current=active;
    setUnloadedTabs(current=>{if(!current.has(active))return current;const next=new Set(current);next.delete(active);return next});
  },[active]);
  useEffect(()=>{
    const minutes={'5 minutes':5,'10 minutes':10,'30 minutes':30,'1 hour':60}[settings.unloadAfter];
    if(!minutes){setUnloadedTabs(current=>current.size?new Set():current);return undefined}
    const sweep=()=>{
      const now=Date.now(),limit=minutes*60000;
      const idle=tabsRef.current.filter(tab=>{
        if(tab.id===previousActive.current||!tab.url||tab.pinned||extensionHost.isBusy(tab.id))return false;
        const seen=lastSeen.current.get(tab.id);
        if(!seen||now-seen<limit)return false;
        try{if(extensionHost.controller(tab.id)?.view.isCurrentlyAudible?.())return false}catch{}
        return true;
      }).map(tab=>tab.id);
      if(idle.length)setUnloadedTabs(current=>{const next=new Set(current);let changed=false;for(const id of idle)if(!next.has(id)){next.add(id);changed=true}return changed?next:current});
    };
    const timer=setInterval(sweep,60000);
    return()=>clearInterval(timer);
  },[settings.unloadAfter,extensionHost]);
  useEffect(()=>{nextTabId.current=Math.max(1,...tabs.map(tab=>Number(tab.id)||0))+1},[tabs]);
  useEffect(()=>{setFindOpen(false);setFindCounts({matches:0,active:0});setZoomPercent(browserRef.current?.zoom('read')||100)},[active]);
  useEffect(()=>{analysisRun.current+=1;setScreenAnalysis({status:'idle'})},[active,activeTab?.url]);
  useEffect(()=>{
    const desktop=window.browseryDesktop;
    if(!desktop?.getGlobalControlState)return undefined;
    desktop.globalControlStatus?.().then(status=>setOwnerControlReady(Boolean(status?.adminReady))).catch(()=>setOwnerControlReady(false));
    desktop.getGlobalControlState().then(next=>{if(next)setLocalControlState(next)}).catch(()=>{});
    return desktop.onGlobalControlState?.(next=>{if(next)setLocalControlState(next)});
  },[]);
  useEffect(()=>{
    let active=true;
    const desktop=window.browseryDesktop;
    if(!desktop?.browseryAccountStatus){setAccountStatus({loading:false,account:null,error:'Browsery accounts require the installed desktop app.'});return()=>{active=false}};
    desktop.browseryAccountStatus().then(result=>{if(active)setAccountStatus({loading:false,account:result?.account||null,error:''})}).catch(()=>{if(active)setAccountStatus({loading:false,account:null,error:'Could not check your Browsery account. Sign in to continue.'})});
    return()=>{active=false};
  },[]);
  const acceptBrowseryAccount=useCallback(account=>setAccountStatus({loading:false,account:account||null,error:''}),[]);
  // First-run setup: shown once per account, right after sign-up or the first
  // sign-in on this device, and never on top of the account gate.
  useEffect(()=>{const id=accountStatus.account?.id;if(!launchComplete||accountStatus.loading||!id){setSetupOpen(false);return}if(!onboardingComplete(id)){setPanel(null);setSetupOpen(true)}},[launchComplete,accountStatus.loading,accountStatus.account?.id]);
  // The Owner button follows the signed-in account: re-check with the server whenever it changes.
  useEffect(()=>{const desktop=window.browseryDesktop;if(!desktop?.globalControlStatus)return;let live=true;desktop.globalControlStatus().then(status=>{if(live)setOwnerControlReady(Boolean(status?.adminReady))}).catch(()=>{});return()=>{live=false}},[accountStatus.account?.id]);
  useEffect(()=>{const panelFeature={analyze:'ai',voice:'voice',extensions:'extensions',music:'music',vpn:'vpn'}[panel];if(panelFeature&&remoteFeatures[panelFeature]===false)setPanel(null)},[panel,remoteFeatures.ai,remoteFeatures.voice,remoteFeatures.extensions,remoteFeatures.music,remoteFeatures.vpn]);
  useEffect(()=>{document.body.classList.toggle('remote-music-disabled',remoteFeatures.music===false);return()=>document.body.classList.remove('remote-music-disabled')},[remoteFeatures.music]);
  useEffect(()=>{const minimum=localControlState.policy?.minimumVersion;if(!launchComplete||!forcedVersionRequired||!minimum||forcedUpdateVersionChecked.current===minimum||!window.browseryDesktop?.checkForAppUpdate||['checking','available','downloading','downloaded','installing'].includes(appUpdate.status))return;forcedUpdateVersionChecked.current=minimum;const timer=setTimeout(()=>window.browseryDesktop.checkForAppUpdate().then(next=>next&&setAppUpdate(next)).catch(()=>{}),900);return()=>clearTimeout(timer)},[launchComplete,forcedVersionRequired,localControlState.policy?.minimumVersion,appUpdate.status]);
  useEffect(()=>{if(activeTabHasPage||settings.power||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;let frame=0,lastX=0,lastY=0;const move=e=>{lastX=e.clientX;lastY=e.clientY;pointer.current={x:lastX/innerWidth-.5,y:lastY/innerHeight-.5};if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const x=lastX/innerWidth-.5,y=lastY/innerHeight-.5,newTab=document.querySelector('.new-tab'),settingsPanel=document.querySelector('.settings-drawer.open');if(newTab){newTab.style.setProperty('--scene-rx',`${-y*((settings.tilt||0)/7)}deg`);newTab.style.setProperty('--scene-ry',`${x*((settings.tilt||0)/6)}deg`)}if(settingsPanel){settingsPanel.style.setProperty('--panel-rx',`${-y*2.2}deg`);settingsPanel.style.setProperty('--panel-ry',`${x*3.1}deg`)}})};addEventListener('mousemove',move,{passive:true});return()=>{removeEventListener('mousemove',move);if(frame)cancelAnimationFrame(frame)}},[settings.tilt,settings.power,activeTabHasPage]);
  useEffect(()=>{setUrl(activeTab?.url||'')},[active,activeTab?.url]);
  useEffect(()=>{
    const accentMap={'Monochrome':'#ffffff','Browsery Cyan':'#65d9ff','Ultraviolet':'#a78bfa','Solar Amber':'#ffbd59','Signal Green':'#56f2a6','Rose Quartz':'#ff7fbc'};
    localStorage.setItem('browsery:settings',JSON.stringify(settings));
    const root=document.documentElement;
    root.style.setProperty('--cyan',accentMap[settings.accentPreset]||settings.glow||'#ffffff');
    root.style.setProperty('--border-glow',settings.glow||'#ffffff');
    root.style.setProperty('--user-blur',`${(settings.blur||0)*.32}px`);
    root.style.setProperty('--panel-opacity',`${.34+(settings.opacity||0)*.0064}`);
    root.style.setProperty('--video-brightness',`${.5+(settings.backgroundBrightness??50)*.01}`);
    root.style.setProperty('--video-contrast',`${.5+(settings.backgroundContrast??50)*.01}`);
    root.style.setProperty('--spatial-depth',`${10+(settings.depth||0)*.56}px`);
    root.style.setProperty('--ui-scale',`${.86+(settings.fontScale||0)*.0028}`);
    root.style.setProperty('--cursor-size',`${18+(settings.cursorSize||0)*.32}px`);
    root.style.setProperty('--motion-speed',`${1.7-(settings.speed||0)*.012}s`);
    root.style.setProperty('--float-duration',`${22-(settings.speed||0)*.14}s`);
    root.style.setProperty('--orbit-duration',`${68-(settings.speed||0)*.42}s`);
    root.style.setProperty('--bloom-strength',`${Math.max(0,settings.bloom||0)/100}`);
    document.body.classList.toggle('reduce-effects',Boolean(settings.power));
    window.browseryDesktop?.updateSettings(settings);
  },[settings]);
  useEffect(()=>{if(!settings.private)localStorage.setItem('browsery:history',JSON.stringify(history))},[history,settings.private]);
  useEffect(()=>{localStorage.setItem('browsery:bookmarks',JSON.stringify(bookmarks))},[bookmarks]);
  useEffect(()=>{localStorage.setItem('browsery:bookmark-folders',JSON.stringify(bookmarkFolders))},[bookmarkFolders]);
  useEffect(()=>{localStorage.setItem('browsery:shortcuts',JSON.stringify(shortcuts))},[shortcuts]);
  useEffect(()=>{localStorage.setItem('browsery:tab-groups',JSON.stringify(tabGroups))},[tabGroups]);
  useEffect(()=>{if(!settings.private)localStorage.setItem('browsery:closed-tabs',JSON.stringify(closedTabs.slice(0,24)))},[closedTabs,settings.private]);
  useEffect(()=>{if(settings.private)return;if(settings.restore)localStorage.setItem('browsery:session',JSON.stringify({tabs,active}));else localStorage.removeItem('browsery:session')},[tabs,active,settings.restore,settings.private]);
  const notify=useCallback(msg=>{setToast(msg);clearTimeout(notify.t);notify.t=setTimeout(()=>setToast(''),1800)},[]);
  const answerPermission=useCallback(async(decision,remember)=>{
    const request=permissionRequest;
    if(!request?.id)return;
    setPermissionRequest(null);
    try{
      const result=await window.browseryDesktop?.respondToPermission?.({id:request.id,decision,remember:Boolean(remember)});
      if(result?.ok)notify(decision==='allow'?`${request.label||'Permission'} allowed${remember?' for this site':''}`:`${request.label||'Permission'} blocked`);
    }catch{notify('Browsery could not update that permission');}
  },[permissionRequest,notify]);
  useEffect(()=>window.browseryDesktop?.onPermissionRequest?.(request=>{
    if(request?.id&&request?.origin)setPermissionRequest(request);
  }),[]);
  useEffect(()=>window.browseryDesktop?.onPermissionResolved?.(result=>{
    setPermissionRequest(current=>current?.id===result?.id?null:current);
  }),[]);
  useEffect(()=>window.browseryDesktop?.onBrowserSettingsApplied?.(payload=>{
    if(payload?.message)notify(payload.message);
  }),[notify]);
  useEffect(()=>{
    const desktop=window.browseryDesktop;
    let active=true;
    desktop?.appUpdateStatus?.().then(next=>{if(active&&next&&typeof next==='object')setAppUpdate(next)}).catch(()=>{});
    const unsubscribe=desktop?.onAppUpdate?.(next=>{if(active&&next&&typeof next==='object')setAppUpdate(next)});
    return()=>{active=false;unsubscribe?.()};
  },[]);
  useEffect(()=>{
    if(!launchComplete||!window.browseryDesktop?.checkForAppUpdate)return;
    let active=true;
    window.browseryDesktop.checkForAppUpdate().then(next=>{
      if(active&&next&&typeof next==='object')setAppUpdate(next);
    }).catch(()=>{});
    return()=>{active=false};
  },[launchComplete]);
  const closeTour=useCallback(()=>{setTourOpen(false);setTourSection(null);setPanel(null);localStorage.setItem('browsery:tutorial-complete-v3','1')},[]);
  const startTour=useCallback(()=>{setTourStep(0);setTourSection(null);setPanel(null);setTourOpen(true)},[]);
  const finishSetup=useCallback(({startTour:wantsTour=false}={})=>{
    const id=accountStatus.account?.id;if(id)markOnboardingComplete(id);
    setSetupOpen(false);
    if(wantsTour){startTour();return}
    // The wizard replaces the automatic first-launch tour; Guide still replays it.
    setTourOpen(false);try{localStorage.setItem('browsery:tutorial-complete-v3','1')}catch{}
  },[accountStatus.account?.id,startTour]);
  const runSetupAgain=useCallback(()=>{setPanel(null);setTourOpen(false);setSetupOpen(true)},[]);
  const moveTour=useCallback((nextIndex)=>{
    const next=presentationSteps[nextIndex];
    setTourStep(nextIndex);
    setTourSection(next?.panel==='settings'?next.section||null:null);
    setPanel(next?.panel||null);
  },[]);
  const nextTour=useCallback(()=>{if(tourStep>=presentationSteps.length-1){closeTour();return}moveTour(tourStep+1)},[tourStep,closeTour,moveTour]);
  const previousTour=useCallback(()=>{if(tourStep>0)moveTour(tourStep-1)},[tourStep,moveTour]);
  const jumpTour=useCallback(id=>{const nextIndex=presentationSteps.findIndex(step=>step.id===id);if(nextIndex>=0)moveTour(nextIndex)},[moveTour]);
  const openTourFeature=useCallback((nextPanel,section=null)=>{setTourOpen(false);setTourSection(nextPanel==='settings'?section:null);setPanel(nextPanel);localStorage.setItem('browsery:tutorial-complete-v3','1')},[]);
  const rememberClosed=useCallback(entries=>{
    // A closed blank tab is still a tab the user may want back. Keep it in
    // the same local undo stack as normal pages instead of silently dropping it.
    const saved=entries.filter(Boolean).map(tab=>normalizeTab({...tab,loading:false}));
    if(!saved.length)return;
    setClosedTabs(current=>[...saved,...current.filter(existing=>!saved.some(item=>item.url===existing.url&&item.title===existing.title))].slice(0,24));
    // Keep Electron's smaller native restore stack in sync for Ctrl+Shift+T
    // pressed while focus is inside a website. Blank tabs stay local because
    // they have no navigable URL for the native layer to restore.
    saved.filter(tab=>tab.url).forEach(tab=>window.browseryDesktop?.rememberClosedTab?.({...tab,group:tab.groupId||''}).catch(()=>{}));
  },[]);
  const openTab=useCallback((target,restored={})=>{
    const id=nextTabId.current++;
    const destination=target??restored.url??null;
    let title=restored.title||'New Space';
    if(destination&&!restored.title){try{title=new URL(destination).hostname||'New page'}catch{title='New page'}}
    setTabs(current=>[...current,normalizeTab({...restored,id,title,url:destination,loading:Boolean(destination)})]);
    setActive(id);setUrl(destination||'');setPanel(null);return id;
  },[]);
  const closeTabs=useCallback(ids=>{
    const requested=new Set(ids),closing=tabs.filter(tab=>requested.has(tab.id));
    if(!closing.length)return;
    const remaining=tabs.filter(tab=>!requested.has(tab.id));
    rememberClosed(closing);
    if(!remaining.length){const id=nextTabId.current++;setTabs([normalizeTab({id,title:'New Space',url:null})]);setActive(id);setUrl('');return}
    if(requested.has(active)){
      const originalIndex=tabs.findIndex(tab=>tab.id===active);
      const nextActive=remaining.find(tab=>tabs.findIndex(item=>item.id===tab.id)>originalIndex)||[...remaining].reverse().find(tab=>tabs.findIndex(item=>item.id===tab.id)<originalIndex)||remaining[0];
      setActive(nextActive.id);
    }
    setTabs(remaining);
  },[tabs,active,rememberClosed]);
  const closeTab=useCallback(id=>closeTabs([id]),[closeTabs]);
  const reopenClosedTab=useCallback(async()=>{
    const localTab=closedTabs[0];
    if(localTab){
      // Native history mirrors URL tabs for keyboard use inside webviews, but
      // the renderer is the source of truth because it also retains blank tabs.
      if(localTab.url)window.browseryDesktop?.reopenClosedTab?.().catch(()=>{});
      setClosedTabs(current=>current.slice(1));openTab(localTab.url,localTab);notify(`Reopened ${localTab.title||addressHost(localTab.url)||'New tab'}`);return;
    }
    let nativeTab=null;
    try{nativeTab=(await window.browseryDesktop?.reopenClosedTab?.())?.tab||null}catch{}
    if(!nativeTab){notify('No closed tabs to reopen');return}
    const tab=normalizeTab({...nativeTab,groupId:nativeTab.group||nativeTab.groupId||null});
    openTab(tab.url,tab);notify(`Reopened ${tab.title||addressHost(tab.url)}`);
  },[closedTabs,openTab,notify]);
  const restoreNativeClosedTab=useCallback(rawTab=>{
    if(!rawTab?.url)return;
    const tab=normalizeTab({...rawTab,groupId:rawTab.group||rawTab.groupId||null});
    setClosedTabs(current=>current.filter(item=>item.url!==tab.url));
    openTab(tab.url,tab);
    notify(`Reopened ${tab.title||addressHost(tab.url)}`);
  },[openTab,notify]);
  useEffect(()=>window.browseryDesktop?.onReopenClosedTab?.(restoreNativeClosedTab),[restoreNativeClosedTab]);
  const setTabGroup=useCallback((id,groupId)=>setTabs(current=>current.map(tab=>tab.id===id?{...tab,groupId}:tab)),[]);
  const createTabGroup=useCallback(tabId=>{
    const requested=window.prompt('Name this tab group');
    const name=String(requested||'').trim().slice(0,42);
    if(!name)return;
    const colors=['#7bdff2','#c8a6ff','#8ce5b2','#ffbe73','#ff92b3','#8fa9ff'];
    const id=`group-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    setTabGroups(current=>[...current,{id,name,color:colors[current.length%colors.length]}]);
    setTabGroup(tabId,id);
  },[setTabGroup]);
  const closeOtherTabs=useCallback(id=>closeTabs(tabs.filter(tab=>tab.id!==id&&!tab.pinned).map(tab=>tab.id)),[tabs,closeTabs]);
  const closeTabsToRight=useCallback(id=>{const index=tabs.findIndex(tab=>tab.id===id);if(index<0)return;closeTabs(tabs.slice(index+1).filter(tab=>!tab.pinned).map(tab=>tab.id))},[tabs,closeTabs]);
  const go=useCallback(q=>{const entry=q||url;const address=resolveAddress(entry,settings.engine);if(!address)return;const blocked=extensionHost.checkNavigation(address);if(blocked){notify(blocked);return}if(activeTab?.url)browserRef.current?.navigate(address);setTabs(current=>current.map(tab=>tab.id===active?{...tab,title:entry.slice(0,48),url:address,loading:true}:tab));setUrl(address);setPanel(null);setFindOpen(false)},[url,active,activeTab?.url,settings.engine,extensionHost,notify]);
  const pageUpdate=useCallback((tabId,update)=>{
    const {currentUrl,...tabUpdate}=update;
    setTabs(current=>current.map(tab=>tab.id===tabId?{...tab,...tabUpdate}:tab));
    const visitedUrl=update.url||currentUrl;
    if(visitedUrl&&!settings.private){
      if(update.url)setHistory(current=>{if(current[0]?.url===visitedUrl)return current;return [{url:visitedUrl,title:update.title||visitedUrl,visitedAt:Date.now()},...current.filter(item=>item.url!==visitedUrl)].slice(0,240)});
      if(update.title)setHistory(current=>current.map(item=>item.url===visitedUrl?{...item,title:update.title}:item));
    }
    if(visitedUrl&&(update.title||update.favicon))setBookmarks(current=>current.map(item=>item.url===visitedUrl?{...item,...(update.title?{title:update.title}:{}),...(update.favicon?{favicon:update.favicon}:{})}:item));
  },[settings.private]);
  const onFindUpdate=useCallback(next=>setFindCounts(next),[]);
  const find=useCallback((query,next)=>browserRef.current?.find(query,next),[]);
  const home=useCallback(()=>{const blank=settings.homepage==='Blank',custom=settings.homepage==='Custom',destination=blank?'about:blank':custom?resolveAddress(settings.homepageUrl,settings.engine):null;if(custom&&!destination){notify('Set a valid custom homepage in Settings → Browser');return}if(destination&&activeTab?.url)browserRef.current?.navigate(destination);let title=blank?'Blank Page':'New Space';if(custom){try{title=new URL(destination).hostname}catch{title=destination}}setTabs(current=>current.map(tab=>tab.id===active?{...tab,title,url:destination,loading:false}:tab));setUrl(destination||'');setFindOpen(false)},[active,activeTab?.url,settings.homepage,settings.homepageUrl,settings.engine,notify]);
  const togglePanel=useCallback(p=>setPanel(current=>current===p?null:p),[]);
  const toggleBookmark=useCallback(()=>{if(!activeTab?.url){notify('Open a page before saving a bookmark');return}const exists=bookmarks.some(item=>item.url===activeTab.url);if(exists){setBookmarks(current=>current.filter(item=>item.url!==activeTab.url));notify('Bookmark removed')}else{setBookmarks(current=>[{url:activeTab.url,title:activeTab.title||activeTab.url,favicon:activeTab.favicon||'',folder:'Favorites',savedAt:Date.now()},...current]);setBookmarkFolders(current=>current.includes('Favorites')?current:['Favorites',...current]);notify('Bookmark saved to Favorites')}},[activeTab,bookmarks,notify]);
  const createBookmarkFolder=useCallback(name=>{
    const folder=String(name||'').trim().slice(0,42);if(!folder)return;
    setBookmarkFolders(current=>current.some(item=>item.toLowerCase()===folder.toLowerCase())?current:[...current,folder]);
  },[]);
  const moveBookmark=useCallback((address,folder)=>{
    createBookmarkFolder(folder);
    setBookmarks(current=>current.map(item=>item.url===address?{...item,folder}:item));
  },[createBookmarkFolder]);
  const importBookmarks=useCallback(items=>{
    const prepared=items.map(item=>({url:normalizeShortcut(item.url),title:String(item.title||'').trim().slice(0,140),folder:String(item.folder||'Imported').trim().slice(0,42)||'Imported'})).filter(item=>item.url);
    const known=new Set(bookmarks.map(item=>item.url));const additions=prepared.filter(item=>!known.has(item.url));
    if(!additions.length){notify('Those bookmarks are already in your library');return}
    const now=Date.now();setBookmarks(current=>[...additions.map(item=>({...item,savedAt:now})),...current]);setBookmarkFolders(current=>Array.from(new Set([...current,...additions.map(item=>item.folder)])));notify(`${additions.length} bookmark${additions.length===1?'':'s'} imported`);
  },[bookmarks,notify]);
  const zoom=useCallback(step=>{const next=browserRef.current?.zoom(step);if(next){setZoomPercent(next);notify(`Zoom ${next}%`);extensionHost.zoomChanged(activeTab?.url,next/100)}},[notify,extensionHost,activeTab?.url]);
  const openAnalysis=useCallback(()=>{if(remoteFeatures.ai===false){notify('Groq analysis is temporarily unavailable');return}setPanel('analyze')},[remoteFeatures.ai,notify]);
  const updateBrowsery=useCallback(async()=>{
    const desktop=window.browseryDesktop;
    if(!desktop?.isDesktop){notify('Updates are available in the Browsery desktop app');return}
    if(['checking','downloading','installing'].includes(appUpdate.status))return;
    try{
      // The desktop updater now checks and downloads in one action. The next
      // press becomes Restart once the installer has been verified.
      const result=appUpdate.status==='downloaded'
        ? await desktop.installAppUpdate?.()
        : await desktop.downloadAppUpdate?.();
      if(result&&typeof result==='object')setAppUpdate(result);
      if(result?.message&&!['available','downloaded','downloading','installing'].includes(result.status))notify(result.message);
      if(result?.ok===false&&result.message)notify(result.message);
    }catch{notify('Browsery could not update right now. Check your connection and try again.')}
  },[appUpdate.status,notify]);
  const analyzeVisiblePage=useCallback(async()=>{
    if(remoteFeatures.ai===false){notify('Groq analysis is temporarily unavailable');return}
    setPanel('analyze');
    if(!activeTab?.url){setScreenAnalysis({status:'no-page'});return}
    const desktop=window.browseryDesktop;
    if(!desktop?.isDesktop||!desktop?.analyzeVisiblePage){setScreenAnalysis({status:'desktop-only'});return}
    const webContentsId=browserRef.current?.getWebContentsId?.();
    if(!Number.isInteger(webContentsId)){setScreenAnalysis({status:'page-loading'});return}
    const run=++analysisRun.current;
    setScreenAnalysis({status:'loading'});
    try{const result=await desktop.analyzeVisiblePage(webContentsId);if(run===analysisRun.current)setScreenAnalysis(result||{status:'request-failed'})}
    catch{if(run===analysisRun.current)setScreenAnalysis({status:'request-failed'})}
  },[activeTab?.url,remoteFeatures.ai,notify]);
  // Hey Groq's live view of Browsery: a few settings, installed extension ids,
  // tab counts and the current site's hostname/title. Never full URLs, search
  // text, cookies, passwords or history. The main process re-validates it.
  const assistantContext=useCallback(()=>{
    const settingKeys=['power','gpu','fps','particles','sleep','unloadAfter','tabs','compact','engine','homepage','suggestions','restore','preload','path','adblock','trackers','https','phishing','cookies','private','doh','aiOverview','aiModel','mutetabs','ambience','accentPreset','backgroundScene','cursorEnabled','showFavorites','clockStyle'];
    const extensionState=extensionHost.getState();
    const address=activeTab?.url||'';
    let page={kind:'other'};
    if(!address)page={kind:'new-tab'};
    else if(address==='about:blank')page={kind:'blank'};
    else if(address.startsWith('browsery:'))page={kind:'search'};
    else{try{const parsed=new URL(address);if(/^https?:$/.test(parsed.protocol))page=settings.private?{kind:'web'}:{kind:'web',host:parsed.hostname,title:String(activeTab?.title||'').slice(0,80)}}catch{}}
    return {
      settings:Object.fromEntries(settingKeys.map(key=>[key,settings[key]])),
      extensions:{installed:Object.keys(extensionState.installed),focusActive:Boolean(extensionState.installed['focus-mode'])&&Number(extensionState.configs['focus-mode']?.endsAt)>Date.now(),autoRefreshTabs:Object.keys(extensionState.refresh||{}).length},
      tabs:{open:tabs.length,unloaded:tabs.filter(tab=>unloadedTabs.has(tab.id)).length,pinned:tabs.filter(tab=>tab.pinned).length,closed:closedTabs.length},
      activeTab:page,
      theme,
      update:appUpdate.status,
      hiddenFeatures:Object.entries(remoteFeatures).filter(([,enabled])=>enabled===false).map(([feature])=>feature),
    };
  },[settings,extensionHost,activeTab?.url,activeTab?.title,tabs,unloadedTabs,closedTabs.length,theme,appUpdate.status,remoteFeatures]);
  const handleShortcut=useCallback(shortcut=>{
    if(!accountStatus.account)return;
    if(shortcut==='focus'){const input=document.querySelector('.omnibox input');input?.focus();input?.select();setPanel(null);return}
    if(shortcut==='new-tab'){openTab();return}
    if(shortcut==='close-tab'){closeTab(active);return}
    if(shortcut==='reopen-tab'){reopenClosedTab();return}
    if(shortcut==='reload'){browserRef.current?.reload();return}
    if(shortcut==='back'){browserRef.current?.back();return}
    if(shortcut==='forward'){browserRef.current?.forward();return}
    if(shortcut==='find'){setFindOpen(true);setPanel(null);return}
    if(shortcut==='history'){setPanel('history');return}
    if(shortcut==='bookmarks'){setPanel('bookmarks');return}
    if(shortcut==='downloads'){setPanel('downloads');return}
    if(shortcut==='bookmark'){toggleBookmark();return}
    if(shortcut==='zoom-in'){zoom(.1);return}
    if(shortcut==='zoom-out'){zoom(-.1);return}
    if(shortcut==='zoom-reset'){zoom(0);return}
    if(shortcut==='escape'){if(findOpen)setFindOpen(false);else setPanel(null)}
  },[openTab,closeTab,reopenClosedTab,active,toggleBookmark,zoom,findOpen,accountStatus.account]);
  useEffect(()=>{
    const onKeyDown=event=>{
      const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
      if(mod&&key==='l'){event.preventDefault();handleShortcut('focus')}
      else if(mod&&event.shiftKey&&key==='t'){event.preventDefault();handleShortcut('reopen-tab')}
      else if(mod&&key==='t'){event.preventDefault();handleShortcut('new-tab')}
      else if(mod&&key==='w'){event.preventDefault();handleShortcut('close-tab')}
      else if(mod&&key==='r'){event.preventDefault();handleShortcut('reload')}
      else if(mod&&key==='f'){event.preventDefault();handleShortcut('find')}
      else if(mod&&key==='h'){event.preventDefault();handleShortcut('history')}
      else if(mod&&event.shiftKey&&key==='b'){event.preventDefault();handleShortcut('bookmarks')}
      else if(mod&&key==='j'){event.preventDefault();handleShortcut('downloads')}
      else if(mod&&key==='d'){event.preventDefault();handleShortcut('bookmark')}
      else if(mod&&(key==='+'||key==='=')){event.preventDefault();handleShortcut('zoom-in')}
      else if(mod&&key==='-'){event.preventDefault();handleShortcut('zoom-out')}
      else if(mod&&key==='0'){event.preventDefault();handleShortcut('zoom-reset')}
      else if(event.altKey&&event.key==='ArrowLeft'){event.preventDefault();handleShortcut('back')}
      else if(event.altKey&&event.key==='ArrowRight'){event.preventDefault();handleShortcut('forward')}
      else if(event.key==='Escape')handleShortcut('escape');
    };
    addEventListener('keydown',onKeyDown);return()=>removeEventListener('keydown',onKeyDown);
  },[handleShortcut]);
  useEffect(()=>window.browseryDesktop?.onShortcut?.(handleShortcut),[handleShortcut]);
  useEffect(()=>window.browseryDesktop?.onNewTab?.(target=>openTab(target)),[openTab]);
  const classes=[`density-${String(settings.chromeDensity).toLowerCase()}`,`corners-${String(settings.cornerStyle).toLowerCase()}`,settings.tabs==='Vertical'?'vertical-tabs':'',settings.compact?'compact-tabs':'',settings.refraction?'has-refraction':'flat-panels',settings.parallax?'has-parallax':'',settings.shadows?'':'no-ui-shadows'].filter(Boolean).join(' ');
  const finishLaunch=useCallback(()=>setLaunchComplete(true),[]);
  const updateToolbarLabel=appUpdate.status==='installing'?'Restarting…':appUpdate.status==='downloaded'?'Restart':appUpdate.status==='downloading'?`${Math.round(Number(appUpdate.progress)||0)}%`:appUpdate.status==='available'?'Update':appUpdate.status==='checking'?'Checking…':'Update';
  const updateToolbarIcon=appUpdate.status==='downloaded'?'reload':'download';
  const updateToolbarBusy=['checking','downloading','installing'].includes(appUpdate.status);
  const updateRequired=launchComplete&&(appUpdate.available||appUpdate.downloaded||forcedVersionRequired);
  return <div data-palette={settings.systemContrast?'system':'custom'} data-accent={settings.accentPreset==='Monochrome'?'monochrome':'color'} className={`app ${theme} desktop-browser ${classes} ${activeTab?.loading?'is-loading':''} ${launchComplete?'':'is-launching'}`}>{!launchComplete&&<LaunchScreen onComplete={finishLaunch}/>}<MagicCursor settings={settings}/>{launchComplete&&!accountStatus.loading&&accountStatus.account&&<div className="browser-shell"><SoundVisualizer audioEngine={audioEngine} enabled={audioReady&&!activeTab?.url&&settings.visualizer&&settings.ambience&&settings.ambienceVolume>0&&settings.master>0}/>
    <TabStrip tabs={tabs} setTabs={setTabs} active={active} setActive={setActive} onNewTab={()=>openTab()} onCloseTab={closeTab} onReopenClosed={reopenClosedTab} closedCount={closedTabs.length} groups={tabGroups} onCloseOthers={closeOtherTabs} onCloseRight={closeTabsToRight} onSetGroup={setTabGroup} onCreateGroup={createTabGroup} unloaded={unloadedTabs}/>
    <div className="toolbar">
      <div className="nav-controls" data-tour="navigation"><GlassButton tour="back" icon="back" label="Back · Alt+←" onClick={()=>browserRef.current?.back()}/><GlassButton tour="forward" icon="forward" label="Forward · Alt+→" onClick={()=>browserRef.current?.forward()}/><GlassButton tour="reload" icon={activeTab?.loading?'close':'reload'} label={activeTab?.loading?'Stop loading':'Reload · Ctrl+R'} onClick={()=>activeTab?.loading?browserRef.current?.stop():browserRef.current?.reload()}/><GlassButton tour="home" icon="home" label="Home" onClick={home}/></div>
      <Omnibox value={url} setValue={setUrl} onGo={go} onAnalyze={openAnalysis} suggestionsEnabled={settings.suggestions} engine={settings.engine} history={settings.private?[]:history} bookmarks={bookmarks}/>
      <div className="toolbar-actions">
        <div className="toolbar-cluster" data-tour="workspace-tools"><GlassButton tour="bookmark" icon="bookmark" label={bookmarks.some(item=>item.url===activeTab?.url)?'Remove bookmark · Ctrl+D':'Save bookmark · Ctrl+D'} active={bookmarks.some(item=>item.url===activeTab?.url)} onClick={toggleBookmark}/><GlassButton tour="bookmarks" icon="grid" label="Bookmarks" active={panel==='bookmarks'} onClick={()=>togglePanel('bookmarks')}/>{remoteFeatures.extensions!==false&&<GlassButton tour="extensions" icon="extension" label="Extensions" active={panel==='extensions'} onClick={()=>togglePanel('extensions')}/>}<GlassButton tour="history" icon="history" label="History · Ctrl+H" active={panel==='history'} onClick={()=>togglePanel('history')}/><GlassButton tour="find" icon="find" label="Find in page · Ctrl+F" active={findOpen} onClick={()=>handleShortcut('find')}/></div>
        <div className="toolbar-cluster" data-tour="privacy-tools"><GlassButton tour="cookies" icon="cookie" label="Cookies & site data" active={panel==='data'} onClick={()=>togglePanel('data')}/><GlassButton tour="protection" icon="shield" label="Privacy shield" active={panel==='protection'} onClick={()=>togglePanel('protection')}/></div>
        <div className="toolbar-cluster" data-tour="media-tools">{remoteFeatures.music!==false&&<GlassButton tour="music" icon="music" label="Ad-free local music" active={panel==='music'} onClick={()=>togglePanel('music')}/ >}{remoteFeatures.voice!==false&&<SpringButton data-tour="voice" className={`analyze-toolbar voice-toolbar ${panel==='voice'?'active':''}`} aria-label="Hey Groq voice assistant" onClick={()=>togglePanel('voice')}><Icon name="spark" size={17}/><span>Hey Groq</span></SpringButton>}{remoteFeatures.ai!==false&&<SpringButton data-tour="analyze" className={`analyze-toolbar ${panel==='analyze'?'active':''}`} aria-label="Analyze with Groq" onClick={openAnalysis}><Icon name="spark" size={17}/><span>Analyze with Groq</span></SpringButton>}</div>
        <div className="toolbar-cluster" data-tour="system-tools"><GlassButton tour="downloads" icon="download" label="Downloads · Ctrl+J" active={panel==='downloads'} onClick={()=>togglePanel('downloads')}/><GlassButton tour="settings" icon="settings" label="Settings" active={panel==='settings'} onClick={()=>togglePanel('settings')}/>{remoteFeatures.vpn!==false&&<GlassButton tour="vpn" icon="vpn" label="Proton VPN" active={panel==='vpn'} onClick={()=>togglePanel('vpn')}/>}<SpringButton className={`update-toolbar ${appUpdate.available?'is-ready':''} ${updateToolbarBusy?'is-busy':''}`} onClick={updateBrowsery} disabled={updateToolbarBusy} aria-label={appUpdate.status==='downloaded'?'Restart Browsery to install update':appUpdate.status==='available'?'Download Browsery update':appUpdate.status==='downloading'?`Downloading Browsery update ${Math.round(Number(appUpdate.progress)||0)} percent`:'Check Browsery updates'}><Icon name={updateToolbarIcon} size={15}/><span>{updateToolbarLabel}</span></SpringButton>{ownerControlReady&&<SpringButton className={`local-control-toolbar ${panel==='local-control'?'active':''}`} onClick={()=>togglePanel('local-control')} aria-label="Open owner controls on this device"><Icon name="shield" size={15}/><span>Owner</span></SpringButton>}<SpringButton data-tour="theme" className="profile" onClick={()=>{setTheme(current=>current==='dark'?'light':'dark');notify('Theme shifted')}} aria-label="Toggle theme">MK</SpringButton><SpringButton data-tour="support" className={`icon-button magnetic support-toolbar ${panel==='support'?'active':''}`} onClick={()=>togglePanel('support')} aria-label={supportUnread?`Help & Support · ${supportUnread} new repl${supportUnread===1?'y':'ies'}`:'Help & Support'} title="Help & Support"><Icon name="support"/>{supportUnread>0&&<i className="support-badge" aria-hidden="true"/>}</SpringButton><SpringButton data-tour="tour" className={`owner-guide-button ${tourOpen?'active':''}`} onClick={startTour} aria-label="Open owner guide"><Icon name="help" size={16}/><span>Guide</span></SpringButton></div>
      </div>
    </div>
    <div className="loading-line"/>{remoteFeatures.announcements!==false&&localControlState.announcements?.length>0&&dismissedAnnouncement!==localControlState.announcements[0].id&&<div className="local-announcement-banner" role="status"><Icon name="alert" size={16}/><div><b>{localControlState.announcements[0].title}</b><span>{localControlState.announcements[0].body}</span><small>Browsery announcement · {localControlState.online?'global':'last known'}</small></div><GlassButton icon="close" label="Dismiss announcement" onClick={()=>setDismissedAnnouncement(localControlState.announcements[0].id)}/></div>}<div className="viewport"><FindBar open={findOpen} onClose={()=>setFindOpen(false)} onFind={find} count={findCounts.matches} active={findCounts.active}/><BrowserViewport ref={browserRef} tabs={tabs} active={active} onSearch={go} onOpenMusic={()=>remoteFeatures.music!==false&&togglePanel('music')} onPageUpdate={pageUpdate} onFindUpdate={onFindUpdate} settings={settings} pointer={pointer} shortcuts={shortcuts} onUpdateShortcuts={setShortcuts} extensionHost={extensionHost} unloadedTabs={unloadedTabs} onBlocked={notify}/></div>
     <AnalyzeDrawer open={panel==='analyze'} onClose={()=>setPanel(null)} tab={activeTab} result={screenAnalysis} onAnalyze={analyzeVisiblePage}/><VoiceAssistantDrawer open={panel==='voice'} onClose={()=>setPanel(null)} model={settings.aiModel} getContext={assistantContext} Icon={Icon} Button={SpringButton} CloseButton={GlassButton}/><ExtensionsDrawer open={panel==='extensions'} onClose={()=>setPanel(null)} host={extensionHost} activeTab={activeTab} onNotice={notify} onOpenTab={openTab} Icon={Icon} Button={SpringButton} CloseButton={GlassButton}/><SettingsDrawer open={panel==='settings'||panel==='privacy'} initialSection={panel==='privacy'?'privacy':'graphics'} focusSection={tourSection} onClose={()=>setPanel(null)} onManageData={()=>setPanel('data')} onManageProtection={()=>setPanel('protection')} onManagePersonal={()=>setPanel('personal')} onRunSetup={runSetupAgain} values={settings} setValues={setSettings} audioEngine={audioEngine} audioReady={audioReady}/><PersonalCenter open={panel==='personal'} onClose={()=>setPanel(null)} onAccountChange={acceptBrowseryAccount} activeUrl={activeTab?.url} webContentsId={browserRef.current?.getWebContentsId?.()} Icon={Icon} Button={SpringButton} CloseButton={GlassButton}/><SupportDrawer open={panel==='support'} onClose={()=>setPanel(null)} account={accountStatus.account} appVersion={appUpdate.currentVersion||''} platform={window.browseryDesktop?.platform||''} voiceAvailable={remoteFeatures.voice!==false} onAskGroq={()=>setPanel('voice')} onRunSetup={runSetupAgain} onUnreadChange={setSupportUnread} Icon={Icon} Button={SpringButton} CloseButton={GlassButton}/><LocalControlCenter open={panel==='local-control'&&ownerControlReady} onClose={()=>setPanel(null)} state={localControlState} onStateChange={setLocalControlState} onAdminReadyChange={setOwnerControlReady} Icon={Icon} Button={SpringButton} CloseButton={GlassButton}/><ProtectionDrawer open={panel==='protection'} onClose={()=>setPanel(null)} tab={activeTab} onOpenSettings={()=>setPanel('privacy')}/><MusicDrawer open={panel==='music'} onClose={()=>setPanel(null)}/><BrowserDataDrawer open={panel==='data'} onClose={()=>setPanel(null)} history={settings.private?[]:history} onClearHistory={()=>setHistory([])}/><DownloadDrawer open={panel==='downloads'} onClose={()=>setPanel(null)} audioEngine={audioEngine}/><VpnPanel open={panel==='vpn'} onClose={()=>setPanel(null)} onOpenGuide={()=>go(window.browseryDesktop?.platform==='darwin'?'https://protonvpn.com/download-macos':'https://protonvpn.com/download-windows')}/>
    <LibraryDrawer open={panel==='history'} onClose={()=>setPanel(null)} title="History" historyMode items={settings.private?[]:history} onSelect={go} onRemove={address=>setHistory(current=>current.filter(item=>item.url!==address))} onClear={()=>setHistory([])}/>
    <BookmarkDrawer open={panel==='bookmarks'} onClose={()=>setPanel(null)} items={bookmarks} folders={bookmarkFolders} onOpen={go} onRemove={address=>setBookmarks(current=>current.filter(item=>item.url!==address))} onMove={moveBookmark} onCreateFolder={createBookmarkFolder} onImport={importBookmarks}/>
    {['maintenance','shutdown'].includes(localControlState.mode)&&<div className="maintenance-lock" role="alertdialog" aria-modal="true" aria-labelledby="maintenance-lock-title"><div className="maintenance-lock-card"><span className="maintenance-lock-kicker">{localControlState.mode==='shutdown'?'Global shutdown':'Global maintenance'}</span><h2 id="maintenance-lock-title">{localControlState.mode==='shutdown'?'Browsery is temporarily shut down':'Browsery is under maintenance'}</h2><p>{localControlState.message||'The Browsery team has temporarily paused browsing.'}</p><small>Browsery will resume when the owner changes the global status. Offline devices update after reconnecting.</small>{ownerControlReady&&<SpringButton type="button" onClick={()=>setPanel('local-control')}>Open owner controls</SpringButton>}</div></div>}
  </div>}{launchComplete&&(!accountStatus.account)&&<AccountGate desktop={window.browseryDesktop} onAuthenticated={acceptBrowseryAccount} Icon={Icon} checking={accountStatus.loading} initialMessage={accountStatus.error}/>}<PermissionPrompt request={permissionRequest} onDecision={answerPermission}/>{launchComplete&&!accountStatus.loading&&accountStatus.account&&<SetupWizard open={setupOpen&&!updateRequired} account={accountStatus.account} desktop={window.browseryDesktop} platform={window.browseryDesktop?.platform||''} onFinish={finishSetup} onOpenLink={target=>openTab(target)} Icon={Icon}/>}<TutorialOverlay open={tourOpen&&launchComplete&&Boolean(accountStatus.account)&&!setupOpen} stepIndex={tourStep} onClose={closeTour} onNext={nextTour} onBack={previousTour} onJump={jumpTour} onOpenFeature={openTourFeature}/>{updateRequired&&accountStatus.account&&<div className="mandatory-update" role="alertdialog" aria-modal="true" aria-labelledby="mandatory-update-title"><div className="mandatory-update-card"><div className="mandatory-update-icon"><Icon name="download" size={22}/></div><span className="eyebrow">Browsery update</span><h2 id="mandatory-update-title">Update required</h2><p>{appUpdate.downloaded?'Restart Browsery to finish installing the update.':'A newer version is ready. Install it before continuing.'}</p><SpringButton className="mandatory-update-action" onClick={updateBrowsery} disabled={updateToolbarBusy}><Icon name={updateToolbarIcon} size={16}/><span>{appUpdate.downloaded?'Restart and update':'Install update'}</span></SpringButton><small>Browsery will continue after the update is installed.</small></div></div>}<Toast message={toast}/></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
