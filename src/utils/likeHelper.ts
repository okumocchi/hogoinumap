export function getOrCreateAnonToken(): string {
  let token = localStorage.getItem('hogoinu_anon_token');
  if (!token) {
    token = 'anon_' + Math.random().toString(36).substring(2) + '_' + Date.now().toString(36);
    localStorage.setItem('hogoinu_anon_token', token);
  }
  return token;
}
