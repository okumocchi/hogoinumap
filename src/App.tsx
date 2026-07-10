import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { type ReactNode, useState } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { useCurrentUser } from './hooks/useCurrentUser';
import { useMyOrganization } from './hooks/useMyOrganization';
import { useMyVolunteer } from './hooks/useMyVolunteer';
import { usePendingAffiliationCount } from './hooks/usePendingAffiliationCount';
import { type ChatParticipant, chatParticipantKey, findOrCreateChatThread } from './lib/chat';
import { DogDetailScreen } from './screens/DogDetailScreen';
import { DogListScreen } from './screens/DogListScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MapScreen } from './screens/MapScreen';
import { OrganizationDashboardScreen } from './screens/OrganizationDashboardScreen';
import { OrganizationDetailScreen } from './screens/OrganizationDetailScreen';
import { SignUpChoiceScreen } from './screens/SignUpChoiceScreen';
import { VolunteerDashboardScreen } from './screens/VolunteerDashboardScreen';
import { VolunteerDetailScreen } from './screens/VolunteerDetailScreen';
import { VolunteerSignUpScreen } from './screens/VolunteerSignUpScreen';
import { OrganizationSignUpScreen } from './screens/OrganizationSignUpScreen';

type FromScreen = 'map' | 'dog-list' | 'gallery';

type Route =
  | { screen: 'map' }
  | { screen: 'dog-list' }
  | { screen: 'gallery' }
  | { screen: 'dog-detail'; dogId: string; from: FromScreen }
  | { screen: 'organization-detail'; organizationId: string; from: FromScreen }
  | { screen: 'volunteer-detail'; volunteerId: string; from: FromScreen }
  | { screen: 'login'; from: FromScreen }
  | { screen: 'signup-choice'; from: FromScreen }
  | { screen: 'org-signup'; from: FromScreen }
  | { screen: 'volunteer-signup'; from: FromScreen }
  | { screen: 'org-dashboard'; from: FromScreen }
  | { screen: 'volunteer-dashboard'; from: FromScreen };

interface ActiveChat {
  threadId: string;
  owners: string[];
  myKey: string;
  myName: string;
  counterpartName: string;
}

function App() {
  const [route, setRoute] = useState<Route>({ screen: 'map' });
  const currentUserEmail = useCurrentUser();
  const [myOrganization, refetchMyOrganization] = useMyOrganization();
  const [myVolunteer, refetchMyVolunteer] = useMyVolunteer();
  const [pendingAffiliationCount, refetchPendingAffiliationCount] = usePendingAffiliationCount(myOrganization?.id);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  // ログイン中ユーザー自身の参加者情報(団体/ボランティアのどちらでもない場合はnull)
  const viewerParticipant = myOrganization
    ? { kind: 'organization' as const, id: myOrganization.id }
    : myVolunteer
      ? { kind: 'volunteer' as const, id: myVolunteer.id }
      : null;

  // マップの初期表示位置(登録ユーザーの場合は自分の登録所在地を中心にする)
  const homeLocation =
    myOrganization?.latitude != null && myOrganization?.longitude != null
      ? { latitude: myOrganization.latitude, longitude: myOrganization.longitude }
      : myVolunteer?.latitude != null && myVolunteer?.longitude != null
        ? { latitude: myVolunteer.latitude, longitude: myVolunteer.longitude }
        : null;

  async function handleStartChat(other: ChatParticipant) {
    const me: Omit<ChatParticipant, 'ownerSub'> | null = myOrganization
      ? { kind: 'organization', id: myOrganization.id, name: myOrganization.name }
      : myVolunteer
        ? { kind: 'volunteer', id: myVolunteer.id, name: myVolunteer.handleName }
        : null;
    if (!me) return;

    const { userId, username } = await getCurrentUser();
    const meParticipant: ChatParticipant = { ...me, ownerSub: `${userId}::${username}` };

    const thread = await findOrCreateChatThread(meParticipant, other);
    setActiveChat({
      threadId: thread.id,
      owners: thread.owners,
      myKey: chatParticipantKey(meParticipant.kind, meParticipant.id),
      myName: meParticipant.name,
      counterpartName: other.name,
    });
  }

  let screen: ReactNode;

  if (route.screen === 'dog-detail') {
    screen = (
      <DogDetailScreen
        dogId={route.dogId}
        onBack={() => setRoute({ screen: route.from })}
      />
    );
  } else if (route.screen === 'organization-detail') {
    screen = (
      <OrganizationDetailScreen
        organizationId={route.organizationId}
        onBack={() => setRoute({ screen: route.from })}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
      />
    );
  } else if (route.screen === 'volunteer-detail') {
    screen = (
      <VolunteerDetailScreen
        volunteerId={route.volunteerId}
        onBack={() => setRoute({ screen: route.from })}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
      />
    );
  } else if (route.screen === 'login') {
    screen = (
      <LoginScreen
        onBack={() => setRoute({ screen: route.from })}
        onComplete={() => setRoute({ screen: route.from })}
        onSignUp={() => setRoute({ screen: 'signup-choice', from: route.from })}
      />
    );
  } else if (route.screen === 'signup-choice') {
    screen = (
      <SignUpChoiceScreen
        onBack={() => setRoute({ screen: route.from })}
        onSelectOrganization={() => setRoute({ screen: 'org-signup', from: route.from })}
        onSelectVolunteer={() => setRoute({ screen: 'volunteer-signup', from: route.from })}
      />
    );
  } else if (route.screen === 'org-signup') {
    screen = (
      <OrganizationSignUpScreen
        onBack={() => setRoute({ screen: route.from })}
        onComplete={() => {
          refetchMyOrganization();
          setRoute({ screen: route.from });
        }}
      />
    );
  } else if (route.screen === 'volunteer-signup') {
    screen = (
      <VolunteerSignUpScreen
        onBack={() => setRoute({ screen: route.from })}
        onComplete={() => {
          refetchMyVolunteer();
          setRoute({ screen: route.from });
        }}
      />
    );
  } else if (route.screen === 'org-dashboard') {
    screen = myOrganization ? (
      <OrganizationDashboardScreen
        organization={myOrganization}
        onBack={() => {
          refetchPendingAffiliationCount();
          setRoute({ screen: route.from });
        }}
        onUpdated={refetchMyOrganization}
      />
    ) : null;
  } else if (route.screen === 'volunteer-dashboard') {
    screen = myVolunteer ? (
      <VolunteerDashboardScreen
        volunteer={myVolunteer}
        onBack={() => setRoute({ screen: route.from })}
        onUpdated={refetchMyVolunteer}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
      />
    ) : null;
  } else if (route.screen === 'dog-list') {
    screen = (
      <DogListScreen
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: 'dog-list' })}
        onBack={() => setRoute({ screen: 'map' })}
      />
    );
  } else if (route.screen === 'gallery') {
    screen = (
      <GalleryScreen
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: 'gallery' })}
        onBack={() => setRoute({ screen: 'map' })}
      />
    );
  } else {
    // Map screen
    const onSelectOrganization = (organizationId: string) =>
      setRoute({ screen: 'organization-detail', organizationId, from: 'map' });
    const onSelectVolunteer = (volunteerId: string) =>
      setRoute({ screen: 'volunteer-detail', volunteerId, from: 'map' });
    const onLogin = () => setRoute({ screen: 'login', from: 'map' });
    const onLogout = () => {
      void signOut();
    };
    const onOpenDashboard = () => {
      if (myOrganization) {
        setRoute({ screen: 'org-dashboard', from: 'map' });
      } else if (myVolunteer) {
        setRoute({ screen: 'volunteer-dashboard', from: 'map' });
      }
    };
    const showDashboardButton = !!myOrganization || !!myVolunteer;

    screen = (
      <MapScreen
        onSelectOrganization={onSelectOrganization}
        onSelectVolunteer={onSelectVolunteer}
        homeLocation={homeLocation}
        onOpenList={() => setRoute({ screen: 'dog-list' })}
        onOpenGallery={() => setRoute({ screen: 'gallery' })}
        currentUserEmail={currentUserEmail}
        onLogin={onLogin}
        onLogout={onLogout}
        showDashboardButton={showDashboardButton}
        onOpenDashboard={onOpenDashboard}
        dashboardBadgeCount={pendingAffiliationCount}
      />
    );
  }

  return (
    <>
      {screen}
      {activeChat && (
        <ChatWindow
          threadId={activeChat.threadId}
          owners={activeChat.owners}
          myKey={activeChat.myKey}
          myName={activeChat.myName}
          counterpartName={activeChat.counterpartName}
          onClose={() => setActiveChat(null)}
        />
      )}
    </>
  );
}

export default App;
