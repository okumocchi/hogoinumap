import { useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { MapboxMap, type MapPinSelection } from '../components/MapboxMap';
import { SlotPlaceholderIcon } from '../components/SlotPlaceholderIcon';
import { useDogThumbnails } from '../hooks/useDogThumbnails';
import { useRegisteredDogs } from '../hooks/useRegisteredDogs';
import { useRegisteredOrganizations } from '../hooks/useRegisteredOrganizations';
import { useRegisteredVolunteers } from '../hooks/useRegisteredVolunteers';
import { useVolunteerFosterSummary } from '../hooks/useVolunteerFosterSummary';
import type { Dog, MapPinData, Organization, Volunteer } from '../types/models';
import { isDogOpenForFosterOffers } from '../utils/dog';
import './MapScreen.css';

type SelectedPin = MapPinSelection;

interface MapScreenProps {
  onSelectOrganization: (organizationId: string) => void;
  onSelectVolunteer: (volunteerId: string) => void;
  homeLocation: { latitude: number; longitude: number } | null;
  onOpenList: () => void;
  onOpenGallery: () => void;
  currentUserEmail: string | null | undefined;
  onLogin: () => void;
  onLogout: () => void;
  showDashboardButton?: boolean;
  onOpenDashboard?: () => void;
  dashboardBadgeCount?: number;
}

export function MapScreen({
  onSelectOrganization,
  onSelectVolunteer,
  homeLocation,
  onOpenList,
  onOpenGallery,
  currentUserEmail,
  onLogin,
  onLogout,
  showDashboardButton,
  onOpenDashboard,
  dashboardBadgeCount,
}: MapScreenProps) {
  const prefectureFilter = 'all';
  const [showSeekingOrgs, setShowSeekingOrgs] = useState(false);
  const [showAvailableVolunteers, setShowAvailableVolunteers] = useState(false);
  const [selectedPin, setSelectedPin] = useState<SelectedPin | null>(null);

  const registeredOrganizations = useRegisteredOrganizations();
  const allOrganizations: Organization[] = registeredOrganizations;

  const registeredDogs = useRegisteredDogs();
  const allDogs: Dog[] = registeredDogs;

  const registeredVolunteers = useRegisteredVolunteers();
  const allVolunteers: Volunteer[] = registeredVolunteers;

  // const prefectureOptions = useMemo(
  //   () =>
  //     Array.from(new Set([...allOrganizations.map((o) => o.prefecture), ...allVolunteers.map((v) => v.prefecture)])),
  //   [allOrganizations, allVolunteers],
  // );

  const orgSeekingMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const dog of allDogs) {
      if (isDogOpenForFosterOffers(dog)) map.set(dog.organizationId, true);
    }
    return map;
  }, [allDogs]);

  const orgPins: MapPinData[] = useMemo(
    () =>
      allOrganizations
        .filter((org) => prefectureFilter === 'all' || org.prefecture === prefectureFilter)
        .filter((org) => !showSeekingOrgs || orgSeekingMap.get(org.id))
        .map((org) => ({
          id: org.id,
          kind: orgSeekingMap.get(org.id) ? 'organization-seeking' : 'organization',
          label: org.name,
          prefecture: org.prefecture,
          city: org.city,
          latitude: org.latitude,
          longitude: org.longitude,
        })),
    [allOrganizations, prefectureFilter, showSeekingOrgs, orgSeekingMap],
  );

  const volunteerPins: MapPinData[] = useMemo(
    () =>
      allVolunteers
        .filter((vol) => prefectureFilter === 'all' || vol.prefecture === prefectureFilter)
        .filter((vol) => !showAvailableVolunteers || vol.hasAvailableSlot)
        .map((vol) => ({
          id: vol.id,
          kind: vol.hasAvailableSlot ? 'volunteer-available' : 'volunteer',
          label: vol.handleName,
          prefecture: vol.prefecture,
          city: vol.city,
          latitude: vol.latitude,
          longitude: vol.longitude,
        })),
    [allVolunteers, prefectureFilter, showAvailableVolunteers],
  );

  const selectedOrganization: Organization | undefined =
    selectedPin?.kind === 'organization' ? allOrganizations.find((o) => o.id === selectedPin.id) : undefined;
  const selectedVolunteer: Volunteer | undefined =
    selectedPin?.kind === 'volunteer' ? allVolunteers.find((v) => v.id === selectedPin.id) : undefined;

  // ポップアップに表示するのは「現在保護されている(=保護中の)」犬のみ
  const selectedOrgProtectedDogIds = useMemo(
    () =>
      selectedOrganization
        ? allDogs
            .filter((d) => d.organizationId === selectedOrganization.id && d.status === 'PROTECTED')
            .sort((a, b) => b.protectedDate.localeCompare(a.protectedDate))
            .map((d) => d.id)
        : [],
    [selectedOrganization, allDogs],
  );
  const orgDogThumbnails = useDogThumbnails(selectedOrgProtectedDogIds);

  const volunteerFosterSummary = useVolunteerFosterSummary(selectedVolunteer?.id);
  const volunteerDogThumbnails = useDogThumbnails(volunteerFosterSummary.fosteredDogIds);

  const sortedVolunteerFosteredDogIds = useMemo(() => {
    const ids = volunteerFosterSummary.fosteredDogIds;
    return [...ids].sort((idA, idB) => {
      const dogA = allDogs.find((d) => d.id === idA);
      const dogB = allDogs.find((d) => d.id === idB);
      if (dogA && dogB) {
        return dogB.protectedDate.localeCompare(dogA.protectedDate);
      }
      if (dogA) return -1;
      if (dogB) return 1;
      return 0;
    });
  }, [volunteerFosterSummary.fosteredDogIds, allDogs]);

  function handleSheetClick() {
    if (selectedOrganization) {
      onSelectOrganization(selectedOrganization.id);
    } else if (selectedVolunteer) {
      onSelectVolunteer(selectedVolunteer.id);
    }
  }

  return (
    <div className="map-screen">
      <AppHeader
        onOpenList={onOpenList}
        onOpenGallery={onOpenGallery}
        currentUserEmail={currentUserEmail}
        onLogin={onLogin}
        onLogout={onLogout}
        showDashboardButton={showDashboardButton}
        onOpenDashboard={onOpenDashboard}
        dashboardBadgeCount={dashboardBadgeCount}
      />

      <div className="map-screen__filters">
        {/* <label className="map-screen__filter-field">
          <span>地域</span>
          <select value={prefectureFilter} onChange={(e) => setPrefectureFilter(e.target.value)}>
            <option value="all">すべて</option>
            {prefectureOptions.map((pref) => (
              <option key={pref} value={pref}>
                {pref}
              </option>
            ))}
          </select>
        </label> */}
        <label className="map-screen__filter-checkbox">
          <input type="checkbox" checked={showSeekingOrgs} onChange={(e) => setShowSeekingOrgs(e.target.checked)} />
          募集中の団体のみ
        </label>
        <label className="map-screen__filter-checkbox">
          <input
            type="checkbox"
            checked={showAvailableVolunteers}
            onChange={(e) => setShowAvailableVolunteers(e.target.checked)}
          />
          受入可能なボランティアのみ
        </label>
      </div>

      <div className="map-screen__map">
        <MapboxMap
          orgPins={orgPins}
          volunteerPins={volunteerPins}
          onSelectPin={setSelectedPin}
          homeLocation={homeLocation}
        />

        <div className="map-screen__legend">
          <span>
            <i className="map-legend-dot map-legend-dot--organization-seeking" />
            団体・募集中
          </span>
          <span>
            <i className="map-legend-dot map-legend-dot--organization" />
            団体
          </span>
          <span>
            <i className="map-legend-dot map-legend-dot--volunteer-available" />
            ボランティア・受入可能
          </span>
          <span>
            <i className="map-legend-dot map-legend-dot--volunteer" />
            ボランティア
          </span>
        </div>
      </div>

      {selectedPin && (selectedOrganization || selectedVolunteer) && (
        <div
          className="map-screen__sheet"
          role="button"
          tabIndex={0}
          onClick={handleSheetClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleSheetClick();
          }}
        >
          <button
            type="button"
            className="map-screen__sheet-close"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedPin(null);
            }}
          >
            閉じる
          </button>

          {selectedOrganization && (
            <div>
              <span className="map-screen__sheet-label map-screen__sheet-label--organization">保護団体</span>
              <h2 className="map-screen__sheet-title">{selectedOrganization.name}</h2>
              <p className="map-screen__sheet-meta">
                {selectedOrganization.prefecture} {selectedOrganization.city}
              </p>
              <div className="map-screen__sheet-thumbs">
                {selectedOrgProtectedDogIds.map((dogId) => (
                  <span key={dogId} className="map-screen__sheet-thumb">
                    {orgDogThumbnails[dogId] ? (
                      <img src={orgDogThumbnails[dogId]} alt="" />
                    ) : (
                      <SlotPlaceholderIcon />
                    )}
                  </span>
                ))}
                {selectedOrgProtectedDogIds.length === 0 && (
                  <p className="map-screen__sheet-empty">現在保護中の保護犬はいません</p>
                )}
              </div>
            </div>
          )}

          {selectedVolunteer && (
            <div>
              <span className="map-screen__sheet-label map-screen__sheet-label--volunteer">預かりボランティア</span>
              <h2 className="map-screen__sheet-title">{selectedVolunteer.handleName}</h2>
              <p className="map-screen__sheet-meta">
                {selectedVolunteer.prefecture} {selectedVolunteer.city}
              </p>
              <div className="map-screen__sheet-thumbs">
                {sortedVolunteerFosteredDogIds.map((dogId) => (
                  <span key={dogId} className="map-screen__sheet-thumb">
                    {volunteerDogThumbnails[dogId] ? <img src={volunteerDogThumbnails[dogId]} alt="" /> : null}
                  </span>
                ))}
                {Array.from({ length: volunteerFosterSummary.availableSlotCount }).map((_, index) => (
                  <span
                    key={`slot-${index}`}
                    className="map-screen__sheet-thumb map-screen__sheet-thumb--slot"
                    aria-label="空きスロット"
                  >
                    <SlotPlaceholderIcon />
                  </span>
                ))}
                {volunteerFosterSummary.fosteredDogIds.length === 0 &&
                  volunteerFosterSummary.availableSlotCount === 0 && (
                    <p className="map-screen__sheet-empty">現在情報がありません</p>
                  )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
