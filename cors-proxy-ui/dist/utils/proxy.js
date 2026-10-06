export async function sendRequest(state) {
    const { url, method, headers, params, body } = state;
    // Build URL with query params
    const urlObj = new URL(url);
    params
        .filter((p) => p.enabled && p.key.trim())
        .forEach((p) => urlObj.searchParams.append(p.key, p.value));
    // Build headers object
    const headersObj = {};
    headers
        .filter((h) => h.enabled && h.key.trim())
        .forEach((h) => (headersObj[h.key] = h.value));
    const start = Date.now();
    const proxyRes = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: urlObj.toString(),
            method,
            headers: headersObj,
            body: method !== "GET" ? body : undefined,
        }),
    });
    const duration = Date.now() - start;
    const data = await proxyRes.json();
    return {
        status: data.status ?? proxyRes.status,
        statusText: data.statusText ?? proxyRes.statusText,
        headers: data.headers ?? {},
        body: typeof data.body === "string"
            ? data.body
            : JSON.stringify(data.body, null, 2),
        duration,
    };
}
