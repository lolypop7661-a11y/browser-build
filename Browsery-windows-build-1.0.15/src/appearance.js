// A one-time appearance update, not a profile reset. Keep browsing data and AI settings.
export function migrateAppearance(saved) {
  if (saved.appearanceProfileVersion === 1) return saved;
  return {
    ...saved,
    appearanceProfileVersion: 1,
    accentPreset: 'Monochrome',
    glow: '#ffffff',
    backgroundScene: 'Original Saturn',
    saturnTilt: -24,
    backgroundBrightness: 50,
    backgroundContrast: 50,
  };
}

export function saturnTiltAngle(value) {
  return Number.isFinite(value) ? Math.max(-45, Math.min(45, value)) : -24;
}
