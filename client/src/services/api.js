const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || '';

export async function getApiHealth({ signal } = {}) {
  const response = await fetch(`${API_ORIGIN}/api/health`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Safe Mandate API health check failed.');
  return response.json();
}
