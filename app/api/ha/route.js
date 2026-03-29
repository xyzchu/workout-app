// app/api/ha/route.js
export async function POST(req) {
  try {
    const { url, token, entities } = await req.json()
    if (!url || !token || !entities?.length) {
      return Response.json({ ok: false, error: 'Missing fields' }, { status: 400 })
    }

    const results = await Promise.allSettled(
      entities.map((e) =>
        fetch(`${url}/api/states/${e.entity_id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: String(e.state),
            attributes: e.attributes,
          }),
        })
      )
    )

    const ok = results.every(
      (r) => r.status === 'fulfilled' && r.value?.ok
    )
    return Response.json({ ok })
  } catch (err) {
    return Response.json(
      { ok: false, error: err.message },
      { status: 500 }
    )
  }
}