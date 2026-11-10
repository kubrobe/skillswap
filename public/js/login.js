import { handleAuthForm } from './auth-form.js';
handleAuthForm('/api/login');
// The demo account, for teachers and visitors who just want to look around
document.getElementById('fill')?.addEventListener('click', () => {
  document.getElementById('email').value = 'aziza@demo.uz';
  document.getElementById('password').value = 'demo12345';
  document.querySelector('#form button[type=submit]').focus();
});
