// Light/dark switch (the day/night toggle from the interactive-day-night-toggle
// experiment). Day (sun) is the default: light page, black wallet. Night (moon):
// dark page, white wallet. The state lives on <body> as .is-day / .is-night, and a
// 'themechange' event tells the 3D scene to fade its colours.
const body = document.body;
const toggle = document.querySelector('.toggle');
const knob = toggle.querySelector('.knob');

// Skip transitions on first paint, enable them after.
requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('preload')));

toggle.addEventListener('click', () => {
  const dark = !body.classList.contains('is-night');
  body.classList.toggle('is-night', dark);
  body.classList.toggle('is-day', !dark);
  toggle.setAttribute('aria-checked', String(dark));
  toggle.setAttribute('aria-label', dark ? 'حالت روشن' : 'حالت تیره');
  document.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));

  // Squash-and-stretch on the knob while it travels (separate from the slide transform).
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    knob.animate(
      [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.14, .88)', offset: 0.25 },
        { transform: 'scale(.94, 1.06)', offset: 0.55 },
        { transform: 'scale(1.02, .98)', offset: 0.75 },
        { transform: 'scale(1, 1)' },
      ],
      { duration: 800, easing: 'ease-out' }
    );
  }
});
