// CarBuddy's face on a web page, drawn live by the firmware's own face code (carbuddy-face.wasm,
// tools/webface/build.sh) at the screen's frame rate.
//
//   const faces = await CarBuddyFace.load("face/");          // where carbuddy-face.js/.wasm are
//   const view = faces.view(canvas, { clip: "happy", loop: true, onlyVisible: true });
//   view.play("dizzy", { loop: false, then: "neutral" });   // a clip once, then back to another
//
// One animation loop draws every view; a view off screen (onlyVisible) sleeps.
(function () {
  "use strict";
  let loading = null;

  function load(base) {
    if (loading) return loading;
    base = base || "";
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = base + "carbuddy-face.js";
      s.onload = () => {
        window.CarBuddyFace_({ locateFile: f => base + f }).then(m => resolve(make(m)), reject);
      };
      s.onerror = () => reject(new Error("carbuddy-face.js not found"));
      document.head.append(s);
    });
    return loading;
  }

  function make(m) {
    const ids = [];
    const count = m._cb_clip_count();
    for (let i = 0; i < count; i++) ids.push(m.UTF8ToString(m._cb_clip_id(i)));
    const index = new Map(ids.map((id, i) => [id, i]));
    const views = new Set();
    let last = 0, running = false;

    function tick(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      let any = false;
      for (const v of views) {
        if (v.sleeping || v.clip < 0 || v.slot < 0) continue;
        any = true;
        if (v.holdUntil) {  // the end of a clip stays on screen a moment before what comes next
          if (now < v.holdUntil) continue;
          v.holdUntil = 0;
          v.next();
          continue;
        }
        if (m._cb_step(v.slot, dt)) v.holdUntil = now + (v.hold || 0);
        const px = m._cb_rgba(v.slot);
        v.image.data.set(m.HEAPU8.subarray(px, px + 240 * 280 * 4));
        v.ctx.putImageData(v.image, 0, 0);
      }
      if (any) requestAnimationFrame(tick);
      else { running = false; last = 0; }
    }
    function wake() {
      if (!running) { running = true; last = 0; requestAnimationFrame(tick); }
    }

    const watcher = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
      for (const e of entries) {
        const v = e.target.__cbView;
        if (!v) continue;
        v.sleeping = !e.isIntersecting;
        if (v.sleeping) v.release();  // out of sight: its memory goes back
        else { v.resume(); wake(); }
      }
    }) : null;

    function view(canvas, opts) {
      opts = opts || {};
      canvas.width = 240;
      canvas.height = 280;
      const v = {
        slot: opts.onlyVisible ? -1 : m._cb_open(), clip: -1, want: null, sleeping: false, holdUntil: 0, hold: 700,
        ctx: canvas.getContext("2d"), image: new ImageData(240, 280),
        // Plays a clip; loop: again and again; then: another clip afterwards (looping).
        play(id, o) {
          o = o || {};
          const i = index.has(id) ? index.get(id) : -1;
          if (i < 0) return false;
          this.want = { id, o };
          if (this.slot < 0) return true;  // starts when it comes into sight
          this.clip = i;
          this.loop = o.loop !== undefined ? o.loop : true;
          this.then = o.then || null;
          this.hold = o.hold !== undefined ? o.hold : 700;
          this.holdUntil = 0;
          m._cb_play(this.slot, i);
          wake();
          return true;
        },
        next() {
          if (this.then && index.has(this.then)) { const t = this.then; this.play(t, { loop: true }); return; }
          if (this.loop) { m._cb_play(this.slot, this.clip); return; }
          this.clip = -1;  // done: the last frame stays
        },
        has(id) { return index.has(id); },
        release() { if (this.slot >= 0) { m._cb_close(this.slot); this.slot = -1; this.clip = -1; } },
        resume() { if (this.slot < 0) { this.slot = m._cb_open(); if (this.want) this.play(this.want.id, this.want.o); } },
        destroy() { this.release(); views.delete(this); if (watcher) watcher.unobserve(canvas); },
      };
      canvas.__cbView = v;
      views.add(v);
      if (opts.onlyVisible && watcher) { v.sleeping = true; watcher.observe(canvas); }
      if (opts.clip) v.play(opts.clip, opts);
      return v;
    }

    return { clips: ids, has: id => index.has(id), view };
  }

  window.CarBuddyFace = { load };
})();
