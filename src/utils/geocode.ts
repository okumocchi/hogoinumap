export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

// 住所の各パーツ(都道府県・市区町村・番地など)からMapBox Geocoding APIで緯度経度を取得する。
// パーツを少なくすれば市区町村レベル、番地まで含めれば実際の所在地レベルの精度になる。
export async function geocodeAddress(...addressParts: string[]): Promise<GeocodeResult | null> {
  const query = addressParts.join('');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}&country=JP&language=ja&limit=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`ジオコーディングに失敗しました(HTTP ${response.status}): ${query}`);
      return null;
    }

    const data = await response.json();
    const [longitude, latitude] = data.features?.[0]?.center ?? [];
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      console.warn(`ジオコーディング結果が見つかりませんでした: ${query}`);
      return null;
    }

    return { latitude, longitude };
  } catch (error) {
    console.warn(`ジオコーディング中にエラーが発生しました: ${query}`, error);
    return null;
  }
}
