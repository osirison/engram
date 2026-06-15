/* smooth-scroll.js
 * Momentum/eased scrolling that keeps the REAL scroll position authoritative
 * (so animation-timeline: view() reveals and the haze progress stay in sync) —
 * we just glide window.scrollY toward a target instead of jumping to it.
 *
 * Only hijacks wheel/trackpad. Touch is already smooth natively, and we bail
 * entirely for coarse pointers and reduced-motion users.
 */
(function () {
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = matchMedia("(pointer: coarse)").matches;
  if (reduce || coarse) return;

  // our JS owns the easing now — kill CSS smooth so scrollTo() lands instantly per frame
  document.documentElement.style.scrollBehavior = "auto";

  var target = window.scrollY;
  var current = window.scrollY;
  var animating = false;
  var raf = 0;
  var EASE = 0.085; // lower = longer, dreamier glide

  function maxY() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }
  function clamp(v) { return Math.max(0, Math.min(v, maxY())); }

  function loop() {
    var diff = target - current;
    if (Math.abs(diff) < 0.35) {
      current = target;
      window.scrollTo(0, Math.round(current));
      animating = false; raf = 0;
      return;
    }
    current += diff * EASE;
    window.scrollTo(0, current);
    raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) { animating = true; raf = requestAnimationFrame(loop); } }

  // normalize wheel delta across deltaMode (pixels / lines / pages)
  function pixels(e) {
    if (e.deltaMode === 1) return e.deltaY * 16;            // lines
    if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // pages
    return e.deltaY;                                        // pixels
  }

  window.addEventListener("wheel", function (e) {
    if (e.ctrlKey) return; // let pinch-zoom through
    e.preventDefault();
    target = clamp(target + pixels(e));
    kick();
  }, { passive: false });

  // resync when scroll moves by other means (keyboard, scrollbar drag, focus, hash jump)
  window.addEventListener("scroll", function () {
    if (!animating) { target = window.scrollY; current = window.scrollY; }
  }, { passive: true });

  window.addEventListener("resize", function () { target = clamp(target); current = clamp(current); });
})();
