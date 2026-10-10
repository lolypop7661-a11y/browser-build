import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const springPresets = Object.freeze({
  // Light mass and a deliberate rebound: controls feel responsive even on a quick tap.
  snappy: Object.freeze({ mass: 0.42, stiffness: 560, damping: 18.5 }),
  // More mass and travel for panels and substantial layout changes.
  fluid: Object.freeze({ mass: 1.1, stiffness: 170, damping: 20 }),
  // For slower, background transitions that should settle without feeling abrupt.
  gentle: Object.freeze({ mass: 1.5, stiffness: 130, damping: 24 }),
});

const reducedMotionQuery = typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)');
const prefersReducedMotion = () => Boolean(
  reducedMotionQuery?.matches
  || document.body?.classList.contains('reduce-effects')
);
const pressResetListeners = new Set();
const resetPressedControls = () => { for (const reset of pressResetListeners) reset(); };
const resetHiddenControls = () => { if (document.hidden) resetPressedControls(); };

function subscribePressReset(reset) {
  if (!pressResetListeners.size) {
    window.addEventListener('blur', resetPressedControls);
    document.addEventListener('visibilitychange', resetHiddenControls);
  }
  pressResetListeners.add(reset);
  return () => {
    pressResetListeners.delete(reset);
    if (!pressResetListeners.size) {
      window.removeEventListener('blur', resetPressedControls);
      document.removeEventListener('visibilitychange', resetHiddenControls);
    }
  };
}

function animateSpring(node, values, targets, config, units = {}) {
  const state = values.current;
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = 0;
  state.node = node;

  Object.entries(targets).forEach(([property, target]) => {
    state.target[property] = target;
    if (state.value[property] == null) {
      const inlineValue = parseFloat(node.style.getPropertyValue(property));
      state.value[property] = Number.isFinite(inlineValue) ? inlineValue : target;
    }
    state.velocity[property] ??= 0;
  });

  const write = () => Object.entries(state.value).forEach(([property, value]) => {
    node.style.setProperty(property, `${value}${units[property] ?? ''}`);
  });

  if (prefersReducedMotion()) {
    Object.assign(state.value, targets);
    Object.keys(targets).forEach(property => { state.velocity[property] = 0; });
    write();
    return;
  }

  let previousTime = performance.now();
  const tick = now => {
    if (prefersReducedMotion()) {
      Object.entries(targets).forEach(([property, target]) => {
        state.value[property] = property === '--spring-scale' ? 1 : target;
        state.velocity[property] = 0;
      });
      write();
      state.frame = 0;
      return;
    }
    // Fixed-size substeps keep under-damped springs stable after a dropped frame.
    const elapsed = Math.min((now - previousTime) / 1000, 1 / 20);
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
    const dt = elapsed / steps;
    previousTime = now;
    let settled = true;

    Object.entries(targets).forEach(([property, target]) => {
      for (let step = 0; step < steps; step += 1) {
        const displacement = target - state.value[property];
        const acceleration = (config.stiffness * displacement - config.damping * state.velocity[property]) / config.mass;
        state.velocity[property] += acceleration * dt;
        state.value[property] += state.velocity[property] * dt;
      }
      const displacement = target - state.value[property];
      if (Math.abs(displacement) > 0.001 || Math.abs(state.velocity[property]) > 0.008) settled = false;
    });

    write();
    if (settled) {
      Object.assign(state.value, targets);
      Object.keys(targets).forEach(property => { state.velocity[property] = 0; });
      write();
      state.frame = 0;
    } else {
      state.frame = requestAnimationFrame(tick);
    }
  };
  state.frame = requestAnimationFrame(tick);
}

/** Physical CSS-variable spring for interruptible press, hover, and focus feedback. */
export function useSpringInteraction({ preset = 'snappy', hoverScale = 1.025, pressScale = 0.94, haptic = 0 } = {}) {
  const values = useRef({ value: { '--spring-scale': 1 }, velocity: { '--spring-scale': 0 }, target: {}, frame: 0, node: null });
  const settings = useRef({ preset, hoverScale, pressScale, haptic });
  const interaction = useRef({ pressed: false, hovered: false, focused: false, key: null });
  settings.current = { preset, hoverScale, pressScale, haptic };

  const restingScale = useCallback(() => (
    interaction.current.hovered || interaction.current.focused ? settings.current.hoverScale : 1
  ), []);

  const moveTo = useCallback((node, target) => {
    const active = settings.current;
    animateSpring(node, values, { '--spring-scale': prefersReducedMotion() ? 1 : target }, springPresets[active.preset] || springPresets.snappy);
  }, []);
  const press = useCallback(node => {
    const state = values.current;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.node = node;
    state.value['--spring-scale'] = prefersReducedMotion() ? 1 : settings.current.pressScale;
    state.velocity['--spring-scale'] = 0;
    state.target['--spring-scale'] = state.value['--spring-scale'];
    node.style.setProperty('--spring-scale', String(state.value['--spring-scale']));
  }, []);

  const onPointerEnter = useCallback(event => {
    interaction.current.hovered = event.pointerType !== 'touch';
    if (!interaction.current.pressed) moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onPointerLeave = useCallback(event => {
    interaction.current.hovered = false;
    // No pointer capture: tab dragging and native button behavior stay unchanged.
    if (!interaction.current.key) interaction.current.pressed = false;
    if (!interaction.current.pressed) moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onPointerDown = useCallback(event => {
    if (event.button !== 0 || event.currentTarget.disabled) return;
    const node = event.currentTarget;
    interaction.current.pressed = true;
    interaction.current.key = null;
    press(node);
    const strength = Math.max(0, Math.min(100, Number(settings.current.haptic) || 0));
    if (event.pointerType === 'touch' && strength > 0 && !prefersReducedMotion()) {
      try { navigator.vibrate?.(Math.round(4 + strength / 8)); } catch { /* Haptics are optional. */ }
    }
  }, [press]);
  const onKeyDown = useCallback(event => {
    if (event.repeat || event.currentTarget.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    interaction.current.pressed = true;
    interaction.current.key = event.key;
    press(event.currentTarget);
  }, [press]);
  const onKeyUp = useCallback(event => {
    if (event.key !== interaction.current.key) return;
    interaction.current.pressed = false;
    interaction.current.key = null;
    moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onPointerUp = useCallback(event => {
    if (event.button !== 0) return;
    interaction.current.pressed = false;
    interaction.current.key = null;
    interaction.current.hovered = event.currentTarget.matches(':hover') && event.pointerType !== 'touch';
    moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onPointerCancel = useCallback(event => {
    interaction.current.pressed = false;
    interaction.current.key = null;
    interaction.current.hovered = false;
    moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onFocus = useCallback(event => {
    interaction.current.focused = event.currentTarget.matches(':focus-visible');
    // Pointer-down is followed by native focus. Do not undo a held press here.
    if (!interaction.current.pressed) moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);
  const onBlur = useCallback(event => {
    interaction.current.focused = false;
    interaction.current.pressed = false;
    interaction.current.key = null;
    moveTo(event.currentTarget, restingScale());
  }, [moveTo, restingScale]);

  useEffect(() => subscribePressReset(() => {
    const node = values.current.node;
    interaction.current = { pressed: false, hovered: false, focused: false, key: null };
    if (node?.isConnected) moveTo(node, 1);
  }), [moveTo]);

  // Cancel any in-flight RAF if a route, tab, or suggestion unmounts mid-spring.
  useEffect(() => () => {
    if (values.current.frame) cancelAnimationFrame(values.current.frame);
  }, []);

  return { onPointerEnter, onPointerLeave, onPointerDown, onPointerUp, onPointerCancel, onKeyDown, onKeyUp, onFocus, onBlur };
}

/** Bounded, event-driven chrome feedback; never transforms the browser or its native guest. */
export function useClickFeedback(settings = {}) {
  const liveSettings = useRef(settings);
  const clearEffects = useRef(() => {});
  liveSettings.current = settings;

  useEffect(() => {
    const layer = document.createElement('div');
    layer.className = 'browsery-click-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:220;contain:layout style paint';
    document.body.append(layer);
    const active = new Set();
    const media = reducedMotionQuery;
    let repeatingKey = false;
    let disposed = false;

    const remove = record => {
      if (!active.delete(record)) return;
      clearTimeout(record.timer);
      for (const animation of record.animations) animation.cancel();
      record.node.remove();
    };
    const clear = () => { for (const record of [...active]) remove(record); };
    clearEffects.current = clear;
    const strength = () => {
      const value = Number(liveSettings.current.motionStrength ?? 72);
      return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 72;
    };
    const disabled = () => disposed || document.hidden || liveSettings.current.power || media?.matches || strength() === 0;
    const control = target => {
      if (!(target instanceof Element) || target.closest('webview,iframe')) return null;
      const node = target.closest('button,a,select,input,[role="button"]');
      if (!node || !node.closest('.desktop-browser') || node.disabled || node.closest('[hidden],[inert],[aria-disabled="true"]') || !node.getClientRects().length) return null;
      return node;
    };
    const emit = (node, x, y) => {
      if (disabled() || typeof node.animate !== 'function') return;
      while (active.size >= 6) remove(active.values().next().value);
      const amount = strength() / 100;
      const burst = document.createElement('span');
      burst.className = 'browsery-click-burst';
      burst.style.left = `${x}px`;
      burst.style.top = `${y}px`;
      burst.style.setProperty('--burst-size', `${56 + amount * 56}px`);
      const record = { node: burst, animations: [], timer: 0 };
      active.add(record);
      layer.append(burst);
      const animate = (element, keyframes, options) => {
        burst.append(element);
        record.animations.push(element.animate(keyframes, { fill: 'both', ...options }));
      };
      for (let index = 0; index < 2; index += 1) {
        const ring = document.createElement('i');
        ring.className = `browsery-click-ring ring-${index + 1}`;
        animate(ring, [
          { transform: 'translate(-50%,-50%) scale(.12)', opacity: index ? .42 : .6 + amount * .32 },
          { transform: `translate(-50%,-50%) scale(${index ? .88 : 1.16})`, opacity: 0 },
        ], { duration: 420 + amount * 100, delay: index * 35, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
      for (let index = 0; index < 4; index += 1) {
        const ray = document.createElement('i');
        ray.className = 'browsery-click-ray';
        const angle = index * 90 + 45;
        animate(ray, [
          { transform: `rotate(${angle}deg) translateX(6px) scaleX(.3)`, opacity: .55 + amount * .35 },
          { transform: `rotate(${angle}deg) translateX(${22 + amount * 36}px) scaleX(.1)`, opacity: 0 },
        ], { duration: 320 + amount * 130, easing: 'cubic-bezier(.2,.75,.25,1)' });
      }
      // A hard deadline also removes effects if a backgrounded animation stops advancing.
      record.timer = setTimeout(() => remove(record), 600);
      Promise.allSettled(record.animations.map(animation => animation.finished)).then(() => remove(record));
    };
    const pointerDown = event => {
      if (event.button !== 0 || disabled()) return;
      const node = control(event.target);
      if (!node) return;
      if (event.pointerType === 'touch') {
        const haptic = Math.max(0, Math.min(100, Number(liveSettings.current.haptic) || 0));
        if (haptic > 0) {
          try { navigator.vibrate?.(Math.round(4 + haptic / 8)); } catch { /* Haptics are optional. */ }
        }
      }
      emit(node, event.clientX, event.clientY);
    };
    const click = event => {
      // Pointer clicks already received down feedback. This path serves keyboard/assistive clicks.
      if (event.detail !== 0 || repeatingKey || disabled()) return;
      const node = control(event.target);
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      emit(node, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    };
    const keyDown = event => {
      if (event.key === 'Enter' || event.key === ' ') repeatingKey = event.repeat;
    };
    const keyUp = event => {
      if (event.key === 'Enter' || event.key === ' ') repeatingKey = false;
    };
    const suspend = () => { repeatingKey = false; clear(); };
    const visibility = () => { if (document.hidden) suspend(); };
    const preference = () => { if (media?.matches) clear(); };
    document.addEventListener('pointerdown', pointerDown, { capture: true, passive: true });
    document.addEventListener('click', click, { capture: true, passive: true });
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('keyup', keyUp, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', suspend);
    media?.addEventListener?.('change', preference);
    return () => {
      disposed = true;
      clear();
      clearEffects.current = () => {};
      layer.remove();
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('keyup', keyUp, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', suspend);
      media?.removeEventListener?.('change', preference);
    };
  }, []);

  useEffect(() => {
    if (settings.power || Number(settings.motionStrength) === 0) clearEffects.current();
  }, [settings.power, settings.motionStrength]);
}

/** Spatial spring presence for panels; depth, yaw, opacity, and blur settle together. */
export function useSpringPresence(open, { preset = 'fluid', offset = 90 } = {}) {
  const ref = useRef(null);
  const values = useRef({ value: {}, velocity: {}, target: {}, frame: 0, node: null });
  const initialized = useRef(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const state = values.current;
    const closedX = Math.ceil(node.getBoundingClientRect().width + offset);
    if (!initialized.current) {
      state.value = { '--spring-x': closedX, '--spring-opacity': 0, '--spring-blur': 8, '--spring-depth-scale': .92, '--spring-angle': -13 };
      state.velocity = { '--spring-x': 0, '--spring-opacity': 0, '--spring-blur': 0, '--spring-depth-scale': 0, '--spring-angle': 0 };
      Object.entries(state.value).forEach(([property, value]) => node.style.setProperty(property, `${value}${property === '--spring-opacity' || property === '--spring-depth-scale' ? '' : property === '--spring-angle' ? 'deg' : 'px'}`));
      initialized.current = true;
      if (!open) return undefined;
    }
    animateSpring(node, values, {
      '--spring-x': open ? 0 : closedX,
      '--spring-opacity': open ? 1 : 0,
      '--spring-blur': open ? 0 : 8,
      '--spring-depth-scale': open ? 1 : .92,
      '--spring-angle': open ? 0 : -13,
    }, springPresets[preset] || springPresets.fluid, { '--spring-x': 'px', '--spring-opacity': '', '--spring-blur': 'px', '--spring-depth-scale': '', '--spring-angle': 'deg' });

    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [open, offset, preset]);

  return ref;
}
