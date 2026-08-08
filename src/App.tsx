import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { GroupChatWindow } from './components/GroupChatWindow';
import { useCurrentUser } from './hooks/useCurrentUser';
import { type MyOrganization, useMyOrganization } from './hooks/useMyOrganization';
import { useMyVolunteer } from './hooks/useMyVolunteer';
import { type ChatThreadItem, useDashboardBadges } from './hooks/useDashboardBadges';
import { type ChatParticipant, chatParticipantKey, findOrCreateChatThread, findOrCreateGroupChatThread } from './lib/chat';
import { dataClient } from './lib/dataClient';
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

type Route =
  | { screen: 'map' }
  | { screen: 'dog-list' }
  | { screen: 'gallery' }
  | { screen: 'dog-detail'; dogId: string }
  | { screen: 'organization-detail'; organizationId: string }
  | { screen: 'volunteer-detail'; volunteerId: string }
  | { screen: 'login' }
  | { screen: 'signup-choice' }
  | { screen: 'org-signup' }
  | { screen: 'volunteer-signup' }
  | { screen: 'org-dashboard'; moderatorOrgId?: string }
  | { screen: 'volunteer-dashboard' };

interface ActiveChat {
  threadId: string;
  owners?: string[];
  myKey: string;
  myName: string;
  counterpartName: string;
  isGroup?: boolean;
}

function ModeratorOrgDashboardLoader({
  organizationId,
  myVolunteerId,
  onBack,
  onOpenChatThread,
  chatThreads,
  chatUnreads,
  pendingMatchOffers,
  onStartGroupChat,
  groupChatUnreads,
  onSelectVolunteer,
}: {
  organizationId: string;
  myVolunteerId?: string;
  onBack: () => void;
  onOpenChatThread: (threadId: string, counterpartName: string, owners: string[]) => void;
  chatThreads: ChatThreadItem[];
  chatUnreads: Record<string, number>;
  pendingMatchOffers: number;
  onStartGroupChat: (orgId: string, orgName: string) => Promise<void>;
  groupChatUnreads: Record<string, number>;
  onSelectVolunteer?: (volunteerId: string) => void;
}) {
  const [org, setOrg] = useState<MyOrganization | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOrg = useCallback(async () => {
    try {
      const res = await dataClient.models.Organization.get({ id: organizationId }, { authMode: 'userPool' });
      if (res.data) {
        setOrg({
          id: res.data.id,
          name: res.data.name,
          prefecture: res.data.prefecture,
          city: res.data.city,
          addressLine: res.data.addressLine,
          latitude: res.data.latitude ?? undefined,
          longitude: res.data.longitude ?? undefined,
          contactEmail: res.data.contactEmail ?? undefined,
          contactPhone: res.data.contactPhone ?? undefined,
          wishlistUrl: res.data.wishlistUrl ?? undefined,
          websiteUrl: res.data.websiteUrl ?? undefined,
          ownerSub: res.data.ownerSub ?? undefined,
        });
      }
    } catch (err) {
      console.error('Failed to load moderator organization:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  if (loading) return <div style={{ padding: '24px', textAlign: 'center' }}>読み込み中…</div>;
  if (!org) return <div style={{ padding: '24px', textAlign: 'center' }}>保護団体情報が見つかりません。</div>;

  return (
    <OrganizationDashboardScreen
      organization={org}
      onBack={onBack}
      onUpdated={loadOrg}
      onOpenChatThread={onOpenChatThread}
      chatThreads={chatThreads}
      chatUnreads={chatUnreads}
      pendingMatchOffers={pendingMatchOffers}
      onStartGroupChat={onStartGroupChat}
      groupChatUnreads={groupChatUnreads}
      isModeratorViewer={true}
      myVolunteerId={myVolunteerId}
      onSelectVolunteer={onSelectVolunteer}
    />
  );
}

function App() {
  const [history, setHistory] = useState<Route[]>([{ screen: 'map' }]);
  const route = history[history.length - 1] ?? { screen: 'map' };

  const pushRoute = useCallback((newRoute: Route) => {
    setHistory((prev) => [...prev, newRoute]);
  }, []);

  const popRoute = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const currentUserEmail = useCurrentUser();
  const [myOrganization, refetchMyOrganization] = useMyOrganization();
  const [myVolunteer, refetchMyVolunteer] = useMyVolunteer();
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  const [badges, refetchBadges] = useDashboardBadges(
    myOrganization?.id,
    myVolunteer?.id,
    activeChat?.threadId ?? null
  );

  // アクティブチャットのスレッド既読処理
  useEffect(() => {
    if (!activeChat) return;

    function markAsRead() {
      if (activeChat!.isGroup) {
        localStorage.setItem(`group_chat_last_read_at:${activeChat!.threadId}`, new Date().toISOString());
      } else {
        localStorage.setItem(`chat_last_read_at:${activeChat!.threadId}`, new Date().toISOString());
      }
      void refetchBadges();
    }

    markAsRead();
    const interval = setInterval(markAsRead, 4000);

    return () => {
      clearInterval(interval);
    };
  }, [activeChat, refetchBadges]);

  function handleOpenChatThread(threadId: string, counterpartName: string, owners: string[]) {
    const me: Omit<ChatParticipant, 'ownerSub'> | null = myOrganization
      ? { kind: 'organization', id: myOrganization.id, name: myOrganization.name }
      : myVolunteer
        ? { kind: 'volunteer', id: myVolunteer.id, name: myVolunteer.handleName }
        : null;
    if (!me) return;

    setActiveChat({
      threadId,
      owners,
      myKey: chatParticipantKey(me.kind, me.id),
      myName: me.name,
      counterpartName,
    });
  }

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

  async function handleStartGroupChat(orgId: string, orgName: string) {
    const me: Omit<ChatParticipant, 'ownerSub'> | null = myOrganization
      ? { kind: 'organization', id: myOrganization.id, name: myOrganization.name }
      : myVolunteer
        ? { kind: 'volunteer', id: myVolunteer.id, name: myVolunteer.handleName }
        : null;
    if (!me) return;

    const thread = await findOrCreateGroupChatThread(orgId, orgName);
    setActiveChat({
      threadId: thread.id,
      myKey: chatParticipantKey(me.kind, me.id),
      myName: me.name,
      counterpartName: thread.organizationName,
      isGroup: true,
    });
  }

  let screen: ReactNode;

  if (route.screen === 'dog-detail') {
    screen = (
      <DogDetailScreen
        dogId={route.dogId}
        onBack={popRoute}
        onSelectOrganization={(orgId) => pushRoute({ screen: 'organization-detail', organizationId: orgId })}
      />
    );
  } else if (route.screen === 'organization-detail') {
    screen = (
      <OrganizationDetailScreen
        organizationId={route.organizationId}
        onBack={popRoute}
        onSelectDog={(dogId) => pushRoute({ screen: 'dog-detail', dogId })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
        onStartGroupChat={handleStartGroupChat}
      />
    );
  } else if (route.screen === 'volunteer-detail') {
    screen = (
      <VolunteerDetailScreen
        volunteerId={route.volunteerId}
        onBack={popRoute}
        onSelectDog={(dogId) => pushRoute({ screen: 'dog-detail', dogId })}
        viewerParticipant={viewerParticipant}
        onStartChat={handleStartChat}
      />
    );
  } else if (route.screen === 'login') {
    screen = (
      <LoginScreen
        onBack={popRoute}
        onComplete={popRoute}
        onSignUp={() => pushRoute({ screen: 'signup-choice' })}
      />
    );
  } else if (route.screen === 'signup-choice') {
    screen = (
      <SignUpChoiceScreen
        onBack={popRoute}
        onSelectOrganization={() => pushRoute({ screen: 'org-signup' })}
        onSelectVolunteer={() => pushRoute({ screen: 'volunteer-signup' })}
      />
    );
  } else if (route.screen === 'org-signup') {
    screen = (
      <OrganizationSignUpScreen
        onBack={popRoute}
        onComplete={() => {
          refetchMyOrganization();
          popRoute();
        }}
      />
    );
  } else if (route.screen === 'volunteer-signup') {
    screen = (
      <VolunteerSignUpScreen
        onBack={popRoute}
        onComplete={() => {
          refetchMyVolunteer();
          popRoute();
        }}
      />
    );
  } else if (route.screen === 'org-dashboard') {
    if (route.moderatorOrgId) {
      screen = (
        <ModeratorOrgDashboardLoader
          organizationId={route.moderatorOrgId}
          myVolunteerId={myVolunteer?.id}
          onBack={() => {
            void refetchBadges();
            popRoute();
          }}
          onOpenChatThread={handleOpenChatThread}
          chatThreads={badges.chatThreads}
          chatUnreads={badges.chatUnreads}
          pendingMatchOffers={badges.pendingMatchOffers}
          onStartGroupChat={handleStartGroupChat}
          groupChatUnreads={badges.groupChatUnreads}
          onSelectVolunteer={(volunteerId) => pushRoute({ screen: 'volunteer-detail', volunteerId })}
        />
      );
    } else {
      screen = myOrganization ? (
        <OrganizationDashboardScreen
          organization={myOrganization}
          onBack={() => {
            void refetchBadges();
            popRoute();
          }}
          onUpdated={refetchMyOrganization}
          onOpenChatThread={handleOpenChatThread}
          chatThreads={badges.chatThreads}
          chatUnreads={badges.chatUnreads}
          pendingMatchOffers={badges.pendingMatchOffers}
          onStartGroupChat={handleStartGroupChat}
          groupChatUnreads={badges.groupChatUnreads}
          onSelectVolunteer={(volunteerId) => pushRoute({ screen: 'volunteer-detail', volunteerId })}
        />
      ) : null;
    }
  } else if (route.screen === 'volunteer-dashboard') {
    screen = myVolunteer ? (
      <VolunteerDashboardScreen
        volunteer={myVolunteer}
        onBack={() => {
          void refetchBadges();
          popRoute();
        }}
        onUpdated={refetchMyVolunteer}
        onSelectDog={(dogId) => pushRoute({ screen: 'dog-detail', dogId })}
        onOpenChatThread={handleOpenChatThread}
        chatThreads={badges.chatThreads}
        chatUnreads={badges.chatUnreads}
        onSelectOrganization={(orgId) => pushRoute({ screen: 'organization-detail', organizationId: orgId })}
        onStartGroupChat={handleStartGroupChat}
        groupChatUnreads={badges.groupChatUnreads}
        onOpenModeratorDashboard={(orgId) => pushRoute({ screen: 'org-dashboard', moderatorOrgId: orgId })}
      />
    ) : null;
  } else if (route.screen === 'dog-list') {
    screen = (
      <DogListScreen
        onSelectDog={(dogId) => pushRoute({ screen: 'dog-detail', dogId })}
        onBack={popRoute}
      />
    );
  } else if (route.screen === 'gallery') {
    screen = (
      <GalleryScreen
        onSelectDog={(dogId) => pushRoute({ screen: 'dog-detail', dogId })}
        onBack={popRoute}
      />
    );
  } else {
    // Map screen
    const onSelectOrganization = (organizationId: string) =>
      pushRoute({ screen: 'organization-detail', organizationId });
    const onSelectVolunteer = (volunteerId: string) =>
      pushRoute({ screen: 'volunteer-detail', volunteerId });
    const onLogin = () => pushRoute({ screen: 'login' });
    const onLogout = () => {
      void signOut();
    };
    const onOpenDashboard = () => {
      if (myOrganization) {
        pushRoute({ screen: 'org-dashboard' });
      } else if (myVolunteer) {
        pushRoute({ screen: 'volunteer-dashboard' });
      }
    };
    const showDashboardButton = !!myOrganization || !!myVolunteer;

    screen = (
      <MapScreen
        onSelectOrganization={onSelectOrganization}
        onSelectVolunteer={onSelectVolunteer}
        homeLocation={homeLocation}
        onOpenList={() => pushRoute({ screen: 'dog-list' })}
        onOpenGallery={() => pushRoute({ screen: 'gallery' })}
        currentUserEmail={currentUserEmail}
        onLogin={onLogin}
        onLogout={onLogout}
        showDashboardButton={showDashboardButton}
        onOpenDashboard={onOpenDashboard}
        dashboardBadgeCount={badges.total}
      />
    );
  }

  return (
    <>
      {screen}
      {activeChat && (
        activeChat.isGroup ? (
          <GroupChatWindow
            threadId={activeChat.threadId}
            myKey={activeChat.myKey}
            myName={activeChat.myName}
            organizationName={activeChat.counterpartName}
            onClose={() => setActiveChat(null)}
          />
        ) : (
          <ChatWindow
            threadId={activeChat.threadId}
            owners={activeChat.owners ?? []}
            myKey={activeChat.myKey}
            myName={activeChat.myName}
            counterpartName={activeChat.counterpartName}
            onClose={() => setActiveChat(null)}
          />
        )
      )}
    </>
  );
}

export default App;
