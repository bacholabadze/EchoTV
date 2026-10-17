(() => {
  const studio = location.pathname.startsWith('/studio');
  const original = location.pathname.endsWith('/original.html');
  const bar = document.createElement('div');
  bar.id = 'echo-version-bar';
  bar.setAttribute('role', 'navigation');
  bar.setAttribute('aria-label', 'Prototype version');
  const label = document.createElement('span');
  label.className = 'version-label';
  label.textContent = studio ? 'The shared room' : original ? 'Particle avatars' : '3D avatars';
  const options = document.createElement('div');
  options.className = 'version-options';
  for (const [name, path, active] of [['Channel', '/', false], ['Current', '/current.html', !original && !studio], ['Original', '/original.html', original], ['Studio', '/studio/', studio]]) {
    const link = document.createElement('a');
    link.textContent = name;
    link.href = path + (/^#episode-[1-3]$/.test(location.hash) ? location.hash : '');
    if (active) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); });
    options.append(link);
  }
  bar.append(label, options);
  document.body.prepend(bar);
})();
