export async function setMemory(key: string, value: string) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }), // ✅ Bon format
  });

  if (!res.ok) {
    console.error('Erreur lors de la sauvegarde mémoire');
  }
}

export async function getMemory(key: string) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${key}`, {
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
    },
  });

  if (!res.ok) {
    console.error('Erreur lors de la lecture mémoire');
    return null;
  }

  const data = await res.json();
  return data.result;
}
