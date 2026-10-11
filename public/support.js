'use strict';
// Támogatási oldal: csak finom megjelenítési animáció (a "mire fordítjuk" kártyák görgetéskor tűnnek elő).
// Nincs fizetési logika, nincs szerverhívás, nincs tárolás: a támogatás a Ko-fi oldalán történik (a fő gomb egyszerű, külső link).
(() => {
  document.documentElement.classList.remove('no-js');
  const reveals = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.2 });
    for (const el of reveals) io.observe(el);
  } else for (const el of reveals) el.classList.add('in');
})();
