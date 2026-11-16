// Lobby profile panel: the player can change their display name and password.
import { api } from './net.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
let app = null;
let onToken = null;

export function initProfile(theApp, { setToken }) {
  app = theApp;
  onToken = setToken;
  $('profileBtn').addEventListener('click', () => { sfx.click(); openProfile(); });
  $('pfClose').onclick = closeProfile;
  $('profile').addEventListener('pointerdown', (e) => { if (e.target.id === 'profile') closeProfile(); });
  // show / hide buttons on the password fields
  document.querySelectorAll('#profile .eye-btn').forEach((b) => b.addEventListener('click', () => {
    const inp = $(b.dataset.for);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.classList.toggle('on', show);
    b.title = b.ariaLabel = show ? 'Hide password' : 'Show password';
  }));
  $('pfNickForm').addEventListener('submit', saveNick);
  $('pfPassForm').addEventListener('submit', changePassword);
}

export const profileOpen = () => !$('profile').classList.contains('hidden');

export function openProfile() {
  $('pfNick').value = app.player?.nickname || '';
  $('pfUser').textContent = app.player?.username || '';
  resetPasswordFields();
  $('profile').classList.remove('hidden');
}

export function closeProfile() {
  $('profile').classList.add('hidden');
  resetPasswordFields();
}

function resetPasswordFields() {
  for (const id of ['pfCur', 'pfNew', 'pfNew2']) { $(id).value = ''; $(id).type = 'password'; }
  document.querySelectorAll('#profile .eye-btn').forEach((b) => { b.classList.remove('on'); b.title = b.ariaLabel = 'Show password'; });
}

async function saveNick(e) {
  e.preventDefault();
  const nickname = $('pfNick').value.trim().replace(/\s+/g, ' ');
  if (nickname === app.player.nickname) { app.toast('That is already your name.'); return; }
  if (!/^[\p{L}\p{N} _.\-]{2,16}$/u.test(nickname)) { app.toast('Name must be 2–16 letters, numbers or spaces.'); sfx.error(); return; }
  try {
    const r = await api('/me', app.net.token, { method: 'PATCH', body: { nickname } });
    app.player.nickname = r.nickname;
    app.onProfileChanged();
    sfx.coin();
    app.toast('Name saved!');
  } catch (err) { app.toast(err.message); sfx.error(); }
}

async function changePassword(e) {
  e.preventDefault();
  const cur = $('pfCur').value, nw = $('pfNew').value, nw2 = $('pfNew2').value;
  if (!cur || !nw) { app.toast('Enter your current and new password.'); sfx.error(); return; }
  if (nw.length < 6 || nw.length > 64) { app.toast('New password must be 6–64 characters.'); sfx.error(); return; }
  if (nw !== nw2) { app.toast('The new passwords do not match.'); sfx.error(); return; }
  try {
    const r = await api('/me/password', app.net.token, { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
    onToken(r.token);
    resetPasswordFields();
    sfx.coin();
    app.toast('Password changed!');
  } catch (err) { app.toast(err.message); sfx.error(); }
}
