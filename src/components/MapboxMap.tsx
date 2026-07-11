import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import type { FeatureCollection, Point } from 'geojson';
import { useEffect, useMemo, useRef } from 'react';
import type { MapPinData, MapPinKind } from '../types/models';

import './MapboxMap.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// 日本全域が収まる範囲(北海道〜沖縄)。初期表示時のfitBoundsに使用。
const JAPAN_BOUNDS: [[number, number], [number, number]] = [
  [122, 24],
  [146, 46],
];

// 登録ユーザーの初期表示時、自分の登録所在地を中心に半径この距離(km)程度が収まるようにする
const HOME_VIEW_RADIUS_KM = 100;
const KM_PER_DEGREE_LATITUDE = 111;

// 指定した緯度経度を中心に、半径HOME_VIEW_RADIUS_KM分の範囲が収まる矩形を求める
// (経度方向は緯度によって1度あたりの距離が変わるため、cosで補正する)
function computeHomeBounds(latitude: number, longitude: number): [[number, number], [number, number]] {
  const latDelta = HOME_VIEW_RADIUS_KM / KM_PER_DEGREE_LATITUDE;
  const lngDelta = HOME_VIEW_RADIUS_KM / (KM_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180));
  return [
    [longitude - lngDelta, latitude - latDelta],
    [longitude + lngDelta, latitude + latDelta],
  ];
}

const PIN_ICON: Record<MapPinKind, string> = {
  'organization-seeking': '🏠',
  organization: '🏠',
  'volunteer-available': '🐾',
  volunteer: '🐾',
};

function dispersePins<T extends MapPinData>(pins: T[]): T[] {
  const coordGroups = new Map<string, T[]>();

  pins.forEach((pin) => {
    const key = `${pin.latitude.toFixed(6)},${pin.longitude.toFixed(6)}`;
    if (!coordGroups.has(key)) {
      coordGroups.set(key, []);
    }
    coordGroups.get(key)!.push(pin);
  });

  const dispersedPins: T[] = [];

  coordGroups.forEach((group) => {
    if (group.length === 1) {
      dispersedPins.push(group[0]);
    } else {
      // 0.009度は緯度方向で約1km相当の距離
      const radius = 0.009;
      group.forEach((pin, index) => {
        const angle = (index * 2 * Math.PI) / group.length;
        const dispersedLatitude = pin.latitude + radius * Math.sin(angle);
        const cosLat = Math.cos((pin.latitude * Math.PI) / 180);
        const dispersedLongitude = pin.longitude + (radius * Math.cos(angle)) / (cosLat || 1);

        dispersedPins.push({
          ...pin,
          latitude: dispersedLatitude,
          longitude: dispersedLongitude,
        });
      });
    }
  });

  return dispersedPins;
}


type EntityKind = 'organization' | 'volunteer';

const ORG_SOURCE_ID = 'org-points';
const VOLUNTEER_SOURCE_ID = 'volunteer-points';
// 初期表示(日本全体)では1px=数km相当になるため、半径を大きくしすぎると
// 実際には離れた都市同士(例: 札幌と弟子屈町)まで1つにまとまってしまう。
const CLUSTER_RADIUS = 20;
const CLUSTER_MAX_ZOOM = 12;

const SOURCE_CONFIG: Array<{ id: string; kind: EntityKind }> = [
  { id: ORG_SOURCE_ID, kind: 'organization' },
  { id: VOLUNTEER_SOURCE_ID, kind: 'volunteer' },
];

// light-v11のデフォルト配色(グレー・青)を、保護犬マップのベージュ系トーンに合わせて上書きする
function applyBeigeTheme(map: mapboxgl.Map) {
  if (map.getLayer('land')) map.setPaintProperty('land', 'background-color', '#f7f0e0');
  if (map.getLayer('water')) map.setPaintProperty('water', 'fill-color', '#e3d3a8');
  if (map.getLayer('landuse')) map.setPaintProperty('landuse', 'fill-color', '#eee2c8');
  if (map.getLayer('national-park')) map.setPaintProperty('national-park', 'fill-color', '#eee2c8');
  if (map.getLayer('building')) map.setPaintProperty('building', 'fill-color', '#efe4cd');
}

// 地図上に3Dの建物を表示するレイヤーを追加する
function add3DBuildings(map: mapboxgl.Map) {
  if (map.getLayer('3d-buildings')) return;

  const style = map.getStyle();
  if (!style || !style.layers) return;

  // ラベルレイヤーのIDを取得して、建物をその下に表示させる（ラベルが建物で隠れないようにするため）
  let labelLayerId: string | undefined;
  for (const layer of style.layers) {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      labelLayerId = layer.id;
      break;
    }
  }

  map.addLayer(
    {
      id: '3d-buildings',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', 'extrude', 'true'],
      type: 'fill-extrusion',
      minzoom: 15,
      paint: {
        'fill-extrusion-color': '#efe4cd', // テーマに合わせたベージュ
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
        'fill-extrusion-opacity': 0.8,
      },
    },
    labelLayerId,
  );
}

// 方位(bearing)・傾き(pitch)だけを0に戻すカスタムコントロール(中心・ズームは変更しない)
function createResetViewControl(): mapboxgl.IControl {
  let map: mapboxgl.Map | undefined;
  let container: HTMLDivElement | undefined;

  return {
    onAdd(mapInstance: mapboxgl.Map) {
      map = mapInstance;
      container = document.createElement('div');
      container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mapboxgl-ctrl-icon map-reset-view-button';
      button.setAttribute('aria-label', '方位をリセット');
      button.title = '方位をリセット';
      button.innerHTML = '<span aria-hidden="true">🧭</span>';
      button.addEventListener('click', () => {
        map?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
      });

      container.appendChild(button);
      return container;
    },
    onRemove() {
      container?.remove();
      map = undefined;
    },
  };
}

interface PinProperties {
  id: string;
  pinKind: MapPinKind;
  label: string;
}

function toFeatureCollection(pins: MapPinData[]): FeatureCollection<Point, PinProperties> {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      properties: { id: pin.id, pinKind: pin.kind, label: pin.label },
      geometry: { type: 'Point', coordinates: [pin.longitude, pin.latitude] },
    })),
  };
}

function clusterSize(count: number): number {
  if (count < 10) return 34;
  if (count < 50) return 44;
  return 54;
}

function createPinMarker(
  map: mapboxgl.Map,
  entityKind: EntityKind,
  props: PinProperties,
  lngLat: [number, number],
  onSelect: (selection: MapPinSelection) => void,
): mapboxgl.Marker {
  const anchor = document.createElement('div');
  anchor.className = 'map-marker-anchor';

  const pinEl = document.createElement('div');
  pinEl.className = `map-pin map-pin--${props.pinKind}`;
  pinEl.setAttribute('role', 'button');
  pinEl.setAttribute('tabindex', '0');
  pinEl.setAttribute('aria-label', props.label);
  pinEl.title = props.label;
  pinEl.innerHTML = `<span class="map-pin__icon" aria-hidden="true">${PIN_ICON[props.pinKind]}</span>`;

  const select = () => onSelect({ kind: entityKind, id: props.id });
  pinEl.addEventListener('click', select);
  pinEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  });

  anchor.appendChild(pinEl);
  return new mapboxgl.Marker({ element: anchor }).setLngLat(lngLat).addTo(map);
}

function createClusterMarker(
  map: mapboxgl.Map,
  sourceId: string,
  entityKind: EntityKind,
  clusterId: number,
  count: number,
  lngLat: [number, number],
): mapboxgl.Marker {
  const size = clusterSize(count);
  const el = document.createElement('div');
  el.className = `map-cluster map-cluster--${entityKind}`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.textContent = String(count);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `${count}件をまとめて表示中。クリックで拡大表示`);

  const expand = () => {
    const source = map.getSource(sourceId);
    if (!source || source.type !== 'geojson') return;
    source.getClusterExpansionZoom(clusterId, (error, zoom) => {
      if (error || zoom == null) return;
      // ちょうど展開ズームぴったりだとタイル境界で「クラスタ」と「個別ピン」が
      // 両方描画される瞬間があるため、閾値を確実に超えるよう少し余分にズームする
      map.easeTo({ center: lngLat, zoom: zoom + 0.5 });
    });
  };
  el.addEventListener('click', expand);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      expand();
    }
  });

  return new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
}

export type MapPinSelection = { kind: EntityKind; id: string };

interface MapboxMapProps {
  orgPins: MapPinData[];
  volunteerPins: MapPinData[];
  onSelectPin: (selection: MapPinSelection) => void;
  // 登録ユーザーの場合、自分の登録所在地を初期表示の中心にする(未登録・未解決の間はnull)
  homeLocation: { latitude: number; longitude: number } | null;
  onLongPress?: (latitude: number, longitude: number) => void;
}

export function MapboxMap({ orgPins, volunteerPins, onSelectPin, homeLocation, onLongPress }: MapboxMapProps) {
  const { dispersedOrgPins, dispersedVolunteerPins } = useMemo(() => {
    const combined = [
      ...orgPins.map((p) => ({ ...p, _sourceKind: 'org' as const })),
      ...volunteerPins.map((p) => ({ ...p, _sourceKind: 'volunteer' as const })),
    ];
    const dispersed = dispersePins(combined);
    return {
      dispersedOrgPins: dispersed
        .filter((p) => p._sourceKind === 'org')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ _sourceKind, ...p }) => p),
      dispersedVolunteerPins: dispersed
        .filter((p) => p._sourceKind === 'volunteer')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ _sourceKind, ...p }) => p),
    };
  }, [orgPins, volunteerPins]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // 初期表示時点で既に自分の所在地が判明していれば、最初からそこを中心に表示する
  // (未解決の場合は日本全体を表示し、後続のeffectで判明次第センタリングし直す)
  const appliedHomeLocationRef = useRef<string | null>(null);

  const onSelectPinRef = useRef(onSelectPin);
  const onLongPressRef = useRef(onLongPress);
  const orgPinsRef = useRef(dispersedOrgPins);
  const volunteerPinsRef = useRef(dispersedVolunteerPins);

  useEffect(() => {
    onSelectPinRef.current = onSelectPin;
    onLongPressRef.current = onLongPress;
    orgPinsRef.current = dispersedOrgPins;
    volunteerPinsRef.current = dispersedVolunteerPins;
  });


  useEffect(() => {
    if (!containerRef.current) return;

    // マウント時点で自分の所在地が既に判明している場合は、最初からそれを初期表示に使う
    const initialHomeLocation = homeLocation;
    if (initialHomeLocation) {
      appliedHomeLocationRef.current = `${initialHomeLocation.latitude},${initialHomeLocation.longitude}`;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: initialHomeLocation
        ? computeHomeBounds(initialHomeLocation.latitude, initialHomeLocation.longitude)
        : JAPAN_BOUNDS,
      fitBoundsOptions: { padding: 32 },
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(createResetViewControl(), 'top-right');

    const language = new MapboxLanguage({
      defaultLanguage: 'ja',
    });
    map.addControl(language);

    function renderPins() {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      for (const { id, kind } of SOURCE_CONFIG) {
        if (!map.getSource(id) || !map.isSourceLoaded(id)) continue;

        const seen = new Set<string>();
        for (const feature of map.querySourceFeatures(id)) {
          if (!feature.geometry || feature.geometry.type !== 'Point') continue;
          const [lng, lat] = feature.geometry.coordinates;
          const props = feature.properties ?? {};

          if (props.cluster) {
            const clusterId = props.cluster_id as number;
            const dedupeKey = `cluster-${clusterId}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            markersRef.current.push(
              createClusterMarker(map, id, kind, clusterId, props.point_count ?? 0, [lng, lat]),
            );
          } else {
            const pinId = props.id as string;
            if (seen.has(pinId)) continue;
            seen.add(pinId);
            markersRef.current.push(
              createPinMarker(map, kind, props as PinProperties, [lng, lat], onSelectPinRef.current),
            );
          }
        }
      }
    }

    map.on('style.load', () => {
      applyBeigeTheme(map);
      add3DBuildings(map);

      map.addSource(ORG_SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection(orgPinsRef.current),
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
      });
      map.addSource(VOLUNTEER_SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection(volunteerPinsRef.current),
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
      });

      // querySourceFeaturesがタイルを参照できるよう、実際に描画はしない透明レイヤーを両ソースに紐付けておく
      // (DOMマーカーで見た目を描画しているため、GLレイヤー自体は不可視でよい)
      for (const { id } of SOURCE_CONFIG) {
        map.addLayer({
          id: `${id}-proxy`,
          type: 'circle',
          source: id,
          paint: { 'circle-opacity': 0, 'circle-radius': 1 },
        });
      }
    });

    map.on('sourcedata', (event) => {
      if (event.isSourceLoaded && (event.sourceId === ORG_SOURCE_ID || event.sourceId === VOLUNTEER_SOURCE_ID)) {
        renderPins();
      }
    });
    map.on('move', renderPins);
    map.on('moveend', renderPins);

    let touchTimeout: number | null = null;
    let touchStartLngLat: mapboxgl.LngLat | null = null;
    const LONG_PRESS_DURATION = 800;

    const cancelTouch = () => {
      if (touchTimeout) {
        clearTimeout(touchTimeout);
        touchTimeout = null;
      }
      touchStartLngLat = null;
    };

    map.on('contextmenu', (e) => {
      if (onLongPressRef.current) {
        onLongPressRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.on('touchstart', (e) => {
      if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) {
        cancelTouch();
        return;
      }
      touchStartLngLat = e.lngLat;
      touchTimeout = window.setTimeout(() => {
        if (onLongPressRef.current && touchStartLngLat) {
          onLongPressRef.current(touchStartLngLat.lat, touchStartLngLat.lng);
        }
        touchTimeout = null;
      }, LONG_PRESS_DURATION);
    });

    map.on('touchmove', (e) => {
      if (touchStartLngLat && touchTimeout) {
        const distance = Math.sqrt(
          Math.pow(e.lngLat.lng - touchStartLngLat.lng, 2) +
          Math.pow(e.lngLat.lat - touchStartLngLat.lat, 2)
        );
        if (distance > 0.001) {
          cancelTouch();
        }
      }
    });

    map.on('touchend', cancelTouch);
    map.on('dragstart', cancelTouch);
    map.on('zoomstart', cancelTouch);

    mapRef.current = map;

    return () => {
      if (touchTimeout) {
        clearTimeout(touchTimeout);
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // homeLocationはマウント時点の値のみを使う(後から判明した場合は下のeffectで反映する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const orgSource = map.getSource(ORG_SOURCE_ID);
    if (orgSource?.type === 'geojson') orgSource.setData(toFeatureCollection(dispersedOrgPins));

    const volunteerSource = map.getSource(VOLUNTEER_SOURCE_ID);
    if (volunteerSource?.type === 'geojson') volunteerSource.setData(toFeatureCollection(dispersedVolunteerPins));
  }, [dispersedOrgPins, dispersedVolunteerPins]);


  // マウント時点では自分の所在地が未解決(認証・DB取得待ち)だった場合に、
  // 判明した時点で改めてそこを中心とした表示に切り替える
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !homeLocation) return;

    const key = `${homeLocation.latitude},${homeLocation.longitude}`;
    if (appliedHomeLocationRef.current === key) return;
    appliedHomeLocationRef.current = key;

    map.fitBounds(computeHomeBounds(homeLocation.latitude, homeLocation.longitude), {
      padding: 32,
      duration: 0,
    });
  }, [homeLocation]);

  return <div ref={containerRef} className="mapbox-map" />;
}
