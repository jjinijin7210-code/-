async function onGoogleSignIn(response) {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    if (!res.ok) throw new Error((await res.json()).error || '로그인 실패');
    window.location.href = '/';
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
  }
}

async function init() {
  const statusEl = document.getElementById('status');
  const res = await fetch('/api/config');
  const { googleClientId } = await res.json();
  if (!googleClientId) {
    statusEl.textContent = '구글 로그인이 아직 설정되지 않았습니다. (관리자에게 문의)';
    return;
  }
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: onGoogleSignIn,
  });
  window.google.accounts.id.renderButton(document.getElementById('g-btn'), {
    theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill',
  });
}

window.addEventListener('load', init);
