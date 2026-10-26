/*
 * Auditoría responsive (copiada de Proyecto X). Se pega en la consola (o en javascript_tool) de la web en marcha.
 * Monta iframes del ancho pedido, deja que la app se pinte y devuelve una lista de problemas:
 * desbordes (documento y elementos), zonas táctiles < 44 px, texto cortado, imágenes deformadas y elementos fijos.
 *
 *   await __audit(360, 740, ['/music', '/music/gustos'])         // detalle por ruta
 *   await __audit(667, 375, ['/music'])                           // móvil en horizontal
 * Nota: los iframes se cargan de 4 en 4 para no ahogar al servidor de desarrollo.
 */
window.__audit = async function (W, H, routes, { settle = 6000, tapMax = 40 } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = []
  for (let i = 0; i < routes.length; i += 4) {
    const batch = routes.slice(i, i + 4)
    const frames = batch.map((rt) => {
      const f = document.createElement('iframe')
      f.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;border:0;opacity:0;pointer-events:none`
      f.src = rt
      document.body.appendChild(f)
      return f
    })
    await wait(settle)
    const sel = (e) => {
      let s = e.tagName.toLowerCase()
      if (e.id) s += '#' + e.id
      const c = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      return (c ? s + '.' + c : s).slice(0, 60)
    }
    frames.forEach((f, k) => {
      const d = f.contentDocument
      const w = f.contentWindow
      const o = { r: batch[k], docOv: d.documentElement.scrollWidth - d.documentElement.clientWidth, off: [], tap: [], tapN: 0, cut: [], img: [], fixed: [] }
      const vis = (e) => {
        const r = e.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return null
        const cs = w.getComputedStyle(e)
        return cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0' ? null : r
      }
      const clipped = (e) => {
        for (let p = e.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
          if (w.getComputedStyle(p).overflowX !== 'visible') {
            const pr = p.getBoundingClientRect()
            if (pr.left >= -1 && pr.right <= W + 1) return true
          }
        }
        return false
      }
      for (const e of d.body.querySelectorAll('*')) {
        const r = vis(e)
        if (!r) continue
        if ((r.right > W + 1 || r.left < -1) && !clipped(e) && o.off.length < 6) o.off.push(sel(e) + ' ' + Math.round(r.left) + '→' + Math.round(r.right))
        if (e.matches('a[href],button,[role=button],[role=tab],[role=switch],input:not([type=hidden]),select,textarea,summary,[role=slider]') && (r.width < 44 || r.height < 44)) {
          o.tapN++
          if (o.tap.length < tapMax) o.tap.push(sel(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18) + '"')
        }
        const cs = w.getComputedStyle(e)
        if (e.scrollWidth > e.clientWidth + 1 && !['visible', 'auto', 'scroll'].includes(cs.overflowX) && e.clientWidth > 4 && (e.textContent || '').trim() && cs.textOverflow !== 'ellipsis' && o.cut.length < 6)
          o.cut.push(sel(e) + ' sw' + e.scrollWidth + '>cw' + e.clientWidth)
        if ((cs.position === 'fixed' || cs.position === 'sticky') && o.fixed.length < 5) o.fixed.push(sel(e) + ' ' + cs.position + ' y' + Math.round(r.top) + '-' + Math.round(r.bottom))
        if (e.tagName === 'IMG' && e.naturalWidth) {
          const a = e.naturalWidth / e.naturalHeight
          const b = r.width / r.height
          if (Math.abs(a - b) / a > 0.06 && cs.objectFit === 'fill' && o.img.length < 4) o.img.push(sel(e) + ' nat' + a.toFixed(2) + ' ren' + b.toFixed(2))
        }
      }
      const m = d.querySelector('main')
      o.main = m ? m.clientHeight + '/' + H : 'sin main'
      o.text = (d.body.innerText || '').trim().slice(0, 20)
      out.push(o)
    })
    frames.forEach((f) => f.remove())
  }
  return out
}
/** Resumen en texto: solo lo que falla. */
window.__sum = async (W, H, routes, opts) =>
  (await window.__audit(W, H, routes, opts))
    .map((x) => {
      if (!x.text) return x.r + ' VACIO'
      const p = []
      if (x.docOv > 0) p.push('DOCOV' + x.docOv)
      if (x.off.length) p.push('off:' + x.off.slice(0, 3).join(';'))
      if (x.tapN) p.push('tap' + x.tapN + ':' + x.tap.slice(0, 3).join(';'))
      if (x.cut.length) p.push('cut:' + x.cut.slice(0, 3).join(';'))
      if (x.img.length) p.push('img:' + x.img.join(';'))
      return x.r + ' main ' + x.main + (p.length ? ' | ' + p.join(' | ') : ' OK')
    })
    .join('\n')
