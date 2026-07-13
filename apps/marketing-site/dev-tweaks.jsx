/* dev-tweaks.jsx — dev-only Tweaks panel wiring.
 *
 * Loaded via a dev-gated dynamic import in app.jsx (`import.meta.env.DEV`),
 * so this module — and tweaks-panel.jsx with it — is dead-code-eliminated
 * from production bundles. Keep every tweaks-panel import routed through
 * here; a static import from app.jsx would ship the panel to visitors.
 */
import React from 'react';
import {
  useTweaks, TweaksPanel, TweakSection,
  TweakSlider, TweakToggle, TweakSelect,
} from './tweaks-panel.jsx';

export default function DevTweaks({ haze, defaults }) {
  const [t, setTweak] = useTweaks(defaults);

  // push tweak values into the haze engine whenever they change
  React.useEffect(() => {
    if (haze) haze.set(t);
  }, [haze, t]);

  return (
    <TweaksPanel>
      <TweakSection label="The field" />
      <TweakToggle
        label="Scroll resolves field"
        value={t.resolveOnScroll}
        onChange={(v) => setTweak("resolveOnScroll", v)}
      />
      <TweakSlider
        label="Haze / blur" value={t.blur} min={3} max={20} step={1} unit="px"
        onChange={(v) => setTweak("blur", v)}
      />
      <TweakSlider
        label="Float speed" value={t.floatSpeed} min={0} max={2.5} step={0.1} unit="×"
        onChange={(v) => setTweak("floatSpeed", v)}
      />
      <TweakSection label="Lantern" />
      <TweakSlider
        label="Reach" value={t.lanternRadius} min={140} max={520} step={10} unit="px"
        onChange={(v) => setTweak("lanternRadius", v)}
      />
      <TweakSlider
        label="Strength" value={t.lanternStrength} min={0.4} max={1.6} step={0.05} unit="×"
        onChange={(v) => setTweak("lanternStrength", v)}
      />
      <TweakSection label="Sacred geometry" />
      <TweakSelect
        label="Shape" value={t.geoShape}
        options={["cycle", "flower", "metatron", "sriYantra", "hexagram", "pentagram", "torus"]}
        onChange={(v) => setTweak("geoShape", v)}
      />
      <TweakToggle
        label="Lantern drifts when idle"
        value={t.idleDrift}
        onChange={(v) => setTweak("idleDrift", v)}
      />
      <TweakSlider
        label="Visibility" value={t.geoOpacity} min={0} max={2} step={0.1} unit="×"
        onChange={(v) => setTweak("geoOpacity", v)}
      />
    </TweaksPanel>
  );
}
