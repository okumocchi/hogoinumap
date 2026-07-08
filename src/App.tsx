import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { type ReactNode, useState } from 'react';
import type { BrowseView } from './components/AppHeader';
import { ChatWindow } from './components/ChatWindow';
import { useCurrentUser } from './hooks/useCurrentUser';
import { useMyOrganization } from './hooks/useMyOrganization';
import { useMyVolunteer } from './hooks/useMyVolunteer';
import { usePendingAffiliationCount } from './hooks/usePendingAffiliationCount';
import { type ChatParticipant, chatParticipantKey, findOrCreateChatThread } from './lib/chat';
import { DogDetailScreen } from './screens/DogDetailScreen';
import { DogListScreen } from './screens/DogListScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MapScreen } from './screens/MapScreen';
import { OrganizationDashboardScreen } from './screens/OrganizationDashboardScreen';
import { OrganizationDetailScreen } from './screens/OrganizationDetailScreen';
import { OrganizationSignUpScreen } from './screens/OrganizationSignUpScreen';
import { SignUpChoiceScreen } from './screens/SignUpChoiceScreen';
import { VolunteerDashboardScreen } from './screens/VolunteerDashboardScreen';
import { VolunteerDetailScreen } from './screens/VolunteerDetailScreen';
import { VolunteerSignUpScreen } from './screens/VolunteerSignUpScreen';

type Route =
  | { screen: 'browse'; view: BrowseView }
  | { screen: 'dog-detail'; dogId: string; from: BrowseView }
  | { screen: 'organization-detail'; organizationId: string; from: BrowseView }
  | { screen: 'volunteer-detail'; volunteerId: string; from: BrowseView }
  | { screen: 'login'; from: BrowseView }
  | { screen: 'signup-choice'; from: BrowseView }
  | { screen: 'org-signup'; from: BrowseView }
  | { screen: 'volunteer-signup'; from: BrowseView }
  | { screen: 'org-dashboard'; from: BrowseView }
  | { screen: 'volunteer-dashboard'; from: BrowseView };

interface ActiveChat {
  threadId: string;
  owners: string[];
  myKey: string;
  myName: string;
  counterpartName: string;
}

function App() {
  const [route, setRoute] = useState<Route>({ screen: 'browse', view: 'map' });
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
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        backLabel={route.from === 'list' ? '一覧に戻る' : '地図に戻る'}
      />
    );
  } else if (route.screen === 'organization-detail') {
    screen = (
      <OrganizationDetailScreen
        organizationId={route.organizationId}
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        backLabel={route.from === 'list' ? '一覧に戻る' : '地図に戻る'}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
      />
    );
  } else if (route.screen === 'volunteer-detail') {
    screen = (
      <VolunteerDetailScreen
        volunteerId={route.volunteerId}
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        backLabel={route.from === 'list' ? '一覧に戻る' : '地図に戻る'}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
      />
    );
  } else if (route.screen === 'login') {
    screen = (
      <LoginScreen
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        onComplete={() => setRoute({ screen: 'browse', view: route.from })}
      />
    );
  } else if (route.screen === 'signup-choice') {
    screen = (
      <SignUpChoiceScreen
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        onSelectOrganization={() => setRoute({ screen: 'org-signup', from: route.from })}
        onSelectVolunteer={() => setRoute({ screen: 'volunteer-signup', from: route.from })}
      />
    );
  } else if (route.screen === 'org-signup') {
    screen = (
      <OrganizationSignUpScreen
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        onComplete={() => {
          refetchMyOrganization();
          setRoute({ screen: 'browse', view: route.from });
        }}
      />
    );
  } else if (route.screen === 'volunteer-signup') {
    screen = (
      <VolunteerSignUpScreen
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        onComplete={() => {
          refetchMyVolunteer();
          setRoute({ screen: 'browse', view: route.from });
        }}
      />
    );
  } else if (route.screen === 'org-dashboard') {
    screen = myOrganization ? (
      <OrganizationDashboardScreen
        organization={myOrganization}
        onBack={() => {
          refetchPendingAffiliationCount();
          setRoute({ screen: 'browse', view: route.from });
        }}
        onUpdated={refetchMyOrganization}
      />
    ) : null;
  } else if (route.screen === 'volunteer-dashboard') {
    screen = myVolunteer ? (
      <VolunteerDashboardScreen
        volunteer={myVolunteer}
        onBack={() => setRoute({ screen: 'browse', view: route.from })}
        onUpdated={refetchMyVolunteer}
        onSelectDog={(dogId) => setRoute({ screen: 'dog-detail', dogId, from: route.from })}
      />
    ) : null;
  } else {
    const onSelectDog = (dogId: string) => setRoute({ screen: 'dog-detail', dogId, from: route.view });
    const onSelectOrganization = (organizationId: string) =>
      setRoute({ screen: 'organization-detail', organizationId, from: route.view });
    const onSelectVolunteer = (volunteerId: string) =>
      setRoute({ screen: 'volunteer-detail', volunteerId, from: route.view });
    const onChangeView = (view: BrowseView) => setRoute({ screen: 'browse', view });
    const onSignUp = () => setRoute({ screen: 'signup-choice', from: route.view });
    const onLogin = () => setRoute({ screen: 'login', from: route.view });
    const onLogout = () => {
      void signOut();
    };
    const onOpenDashboard = () => {
      if (myOrganization) {
        setRoute({ screen: 'org-dashboard', from: route.view });
      } else if (myVolunteer) {
        setRoute({ screen: 'volunteer-dashboard', from: route.view });
      }
    };
    const showDashboardButton = !!myOrganization || !!myVolunteer;

    screen =
      route.view === 'list' ? (
        <DogListScreen
          onSelectDog={onSelectDog}
          activeView={route.view}
          onChangeView={onChangeView}
          onSignUp={onSignUp}
          currentUserEmail={currentUserEmail}
          onLogin={onLogin}
          onLogout={onLogout}
          showDashboardButton={showDashboardButton}
          onOpenDashboard={onOpenDashboard}
          dashboardBadgeCount={pendingAffiliationCount}
        />
      ) : (
        <MapScreen
          onSelectOrganization={onSelectOrganization}
          onSelectVolunteer={onSelectVolunteer}
          homeLocation={homeLocation}
          activeView={route.view}
          onChangeView={onChangeView}
          onSignUp={onSignUp}
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
