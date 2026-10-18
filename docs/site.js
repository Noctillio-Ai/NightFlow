const menu = document.querySelector('.menu');
const navigation = document.querySelector('#navigation');
menu?.addEventListener('click', () => {
  const expanded = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(expanded));
  navigation.classList.toggle('open', expanded);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    menu.setAttribute('aria-expanded', 'false'); navigation.classList.remove('open'); menu.focus();
  }
});
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => {
  const text = button.parentElement.querySelector('code').textContent;
  const status = button.parentElement.querySelector('.copy-status');
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; status.textContent = 'Copied to clipboard.'; }
  catch { status.textContent = 'Select the code and copy it manually.'; }
  setTimeout(() => { button.textContent = 'Copy'; status.textContent = ''; }, 2500);
}));
const lightbox = document.querySelector('.lightbox');
if (lightbox?.showModal) {
  const lightboxImg = lightbox.querySelector('img');
  const lightboxCaption = lightbox.querySelector('.lightbox-caption');
  let opener = null;
  document.querySelectorAll('.shot-frame').forEach(frame => frame.addEventListener('click', () => {
    const img = frame.querySelector('img');
    opener = frame;
    lightboxImg.src = frame.dataset.full;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = frame.closest('figure').querySelector('h3').textContent + ' — ' + img.alt;
    lightbox.showModal();
  }));
  lightbox.querySelector('.lightbox-close').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('close', () => opener?.focus());
}
