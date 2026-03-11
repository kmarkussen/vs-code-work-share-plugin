import { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Container,
    CssBaseline,
    Dialog,
    DialogContent,
    Divider,
    Drawer,
    FormControlLabel,
    IconButton,
    Link,
    List,
    ListItemIcon,
    ListItemButton,
    ListItemText,
    Paper,
    Pagination,
    Stack,
    Switch,
    TextField,
    ThemeProvider,
    Toolbar,
    Typography,
    createTheme,
} from "@mui/material";
import {
    ArrowOutward as ArrowOutwardIcon,
    Article as ArticleIcon,
    CheckCircleOutline as CheckCircleOutlineIcon,
    Close as CloseIcon,
    DashboardCustomize as DashboardCustomizeIcon,
    Difference as DifferenceIcon,
    Download as DownloadIcon,
    GroupAdd as GroupAddIcon,
    Group as GroupIcon,
    ManageAccounts as ManageAccountsIcon,
    Fullscreen as FullscreenIcon,
    Hub as HubIcon,
    Insights as InsightsIcon,
    Lan as LanIcon,
    Menu as MenuIcon,
    PersonSearch as PersonSearchIcon,
    Share as ShareIcon,
} from "@mui/icons-material";
import {
    fetchActivities,
    fetchInvitations,
    fetchCurrentUser,
    fetchFiles,
    fetchPatches,
    fetchSshKeys,
    fetchTeamDetails,
    fetchTeams,
    isUnauthorizedError,
    loginUser,
    logoutUser,
    registerUser,
    acceptInvitation,
    createTeam,
    deleteTeam,
    inviteTeamMember,
    leaveOrDeclineTeam,
    toggleTeamSharing,
    updateCurrentUserProfile,
    addSshKey,
    deleteSshKey,
    type AuthCredentials,
    type AuthUserProfile,
    type ProfileUpdatePayload,
    type RegisterPayload,
    type SshKeyEntry,
    type TeamDetails,
    type TeamInvitation,
    type TeamSummary,
} from "./api";
import {
    buildActivityFeed,
    buildDashboardMetrics,
    buildFeaturedPatches,
    buildRepositorySummaries,
    buildRepositoryTree,
    buildUserSummaries,
    extractFileName,
    formatRelativeTime,
} from "./dashboardData";
import { Activity, Patch, RepositoryFiles } from "./types";

const LANDING_PATH = "/";
const DASHBOARD_PATH = "/dashboard";
const TEAMS_PATH = "/teams";
const PROFILE_PATH = "/profile";

const INSTALL_STEPS = [
    "Download the latest VSIX package from this site.",
    "In VS Code, open Extensions and choose Install from VSIX.",
    "Set workShare.apiServerUrl to this server and confirm your identity settings.",
    "Open the Work Share view and start sharing file activity and patches.",
];

const CAPABILITY_CALLOUTS = [
    {
        title: "See ownership before overlap happens",
        detail: "Spot active files, working changes, and pending commits across repositories before work collides.",
        icon: PersonSearchIcon,
    },
    {
        title: "Review diffs without leaving the site",
        detail: "Browse patch streams in a dedicated diff workspace with fast preview and fullscreen mode.",
        icon: DifferenceIcon,
    },
    {
        title: "Track repository motion in real time",
        detail: "Use repository trees and activity logs to understand what changed, where, and by whom.",
        icon: LanIcon,
    },
];

interface NavigationEntry {
    label: string;
    href: string;
    icon: React.ElementType;
}

interface VsixInfo {
    available: boolean;
    fileName?: string;
    downloadUrl?: string;
    message?: string;
}

const theme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#0c7a6b",
        },
        secondary: {
            main: "#bc5a2f",
        },
        background: {
            default: "#f4efe6",
            paper: "#fffaf2",
        },
        text: {
            primary: "#1f2a24",
            secondary: "#55645c",
        },
    },
    typography: {
        fontFamily: ['"Avenir Next"', '"Segoe UI Variable"', '"Helvetica Neue"', "sans-serif"].join(","),
        h1: {
            fontWeight: 700,
            letterSpacing: "-0.04em",
        },
        h2: {
            fontWeight: 700,
            letterSpacing: "-0.03em",
        },
        h3: {
            fontWeight: 700,
            letterSpacing: "-0.02em",
        },
    },
    shape: {
        borderRadius: 20,
    },
});

function App() {
    const currentPath = window.location.pathname;
    const isDashboardRoute = currentPath === DASHBOARD_PATH;
    const isTeamsRoute = currentPath === TEAMS_PATH;
    const isProfileRoute = currentPath === PROFILE_PATH;
    const isLandingRoute = currentPath === LANDING_PATH;
    const [activities, setActivities] = useState<Activity[]>([]);
    const [patches, setPatches] = useState<Patch[]>([]);
    const [repositories, setRepositories] = useState<RepositoryFiles[]>([]);
    const [loading, setLoading] = useState(true);
    const [vsixInfo, setVsixInfo] = useState<VsixInfo>({
        available: false,
        message: "Checking for available VSIX package...",
    });
    const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);
    const [isDiffDrawerOpen, setIsDiffDrawerOpen] = useState(false);
    const [isFullscreenDiffOpen, setIsFullscreenDiffOpen] = useState(false);
    const [isNavigationDrawerOpen, setIsNavigationDrawerOpen] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<AuthUserProfile | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [teams, setTeams] = useState<TeamSummary[]>([]);
    const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
    const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<TeamDetails | null>(null);
    const [teamLoading, setTeamLoading] = useState(false);
    const [teamError, setTeamError] = useState<string | null>(null);
    const [teamActionMessage, setTeamActionMessage] = useState<string | null>(null);
    const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>([]);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [profileActionMessage, setProfileActionMessage] = useState<string | null>(null);

    useEffect(() => {
        const initializeSession = async () => {
            try {
                const profile = await fetchCurrentUser();
                setCurrentUser(profile);
                setIsAuthenticated(true);
                if (isTeamsRoute) {
                    await loadCollaborationData();
                }
                if (isProfileRoute) {
                    await loadProfileData();
                }
                if (isDashboardRoute || isLandingRoute) {
                    await loadData();
                } else {
                    setLoading(false);
                }
            } catch (error) {
                if (!isUnauthorizedError(error)) {
                    console.error("Failed to initialize session:", error);
                }
                setIsAuthenticated(false);
                setCurrentUser(null);
                setTeams([]);
                setInvitations([]);
                setSelectedTeamName(null);
                setSelectedTeam(null);
                setSshKeys([]);
                setLoading(false);
            } finally {
                setAuthLoading(false);
            }
        };

        void initializeSession();
    }, [isDashboardRoute, isLandingRoute, isProfileRoute, isTeamsRoute]);

    useEffect(() => {
        if (!isAuthenticated || !(isDashboardRoute || isLandingRoute)) {
            return;
        }

        const interval = setInterval(() => {
            void loadData();
        }, 5000);
        return () => clearInterval(interval);
    }, [isAuthenticated, isDashboardRoute, isLandingRoute]);

    useEffect(() => {
        if (!isAuthenticated || !isTeamsRoute) {
            return;
        }

        const interval = setInterval(() => {
            void loadCollaborationData();
        }, 7000);
        return () => clearInterval(interval);
    }, [isAuthenticated, isTeamsRoute, selectedTeamName]);

    useEffect(() => {
        const loadVsixInfo = async () => {
            try {
                const response = await fetch("/downloads/vsix-info");
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    setVsixInfo({
                        available: false,
                        message:
                            typeof errorData?.message === "string" ?
                                errorData.message
                            :   "No packaged VSIX available right now. Run npm run package from the workspace root.",
                    });
                    return;
                }

                const data = (await response.json()) as VsixInfo;
                setVsixInfo(data);
            } catch {
                setVsixInfo({
                    available: false,
                    message: "Unable to check VSIX availability right now.",
                });
            }
        };

        void loadVsixInfo();
    }, []);

    const dashboardMetrics = useMemo(
        () => buildDashboardMetrics(activities, patches, repositories),
        [activities, patches, repositories],
    );
    const activityFeed = useMemo(() => buildActivityFeed(activities, patches), [activities, patches]);
    const featuredPatches = useMemo(() => buildFeaturedPatches(patches), [patches]);
    const repositoryTree = useMemo(() => buildRepositoryTree(repositories), [repositories]);
    const repositorySummaries = useMemo(() => buildRepositorySummaries(repositories), [repositories]);
    const userSummaries = useMemo(
        () => buildUserSummaries(activities, patches, repositories),
        [activities, patches, repositories],
    );

    useEffect(() => {
        if (featuredPatches.length === 0) {
            setSelectedPatchId(null);
            return;
        }

        setSelectedPatchId((current) => {
            if (current && featuredPatches.some((item) => item.id === current)) {
                return current;
            }

            return featuredPatches[0]?.id ?? null;
        });
    }, [featuredPatches]);

    const selectedPatch = featuredPatches.find((patch) => patch.id === selectedPatchId) ?? null;

    const loadData = async () => {
        try {
            const [activitiesData, patchesData, filesData] = await Promise.all([
                fetchActivities(),
                fetchPatches(),
                fetchFiles(),
            ]);
            setActivities(activitiesData);
            setPatches(patchesData);
            setRepositories(filesData);
        } catch (error) {
            if (isUnauthorizedError(error)) {
                setIsAuthenticated(false);
                setCurrentUser(null);
                setActivities([]);
                setPatches([]);
                setRepositories([]);
                setIsDiffDrawerOpen(false);
                setIsFullscreenDiffOpen(false);
                return;
            }

            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadCollaborationData = async (preferredTeamName?: string) => {
        setTeamLoading(true);
        setTeamError(null);

        try {
            const [teamsData, invitationsData] = await Promise.all([fetchTeams(), fetchInvitations()]);
            setTeams(teamsData);
            setInvitations(invitationsData);

            let nextTeamName = preferredTeamName ?? selectedTeamName;
            if (nextTeamName && !teamsData.some((team) => team.teamName === nextTeamName)) {
                nextTeamName = null;
            }
            if (!nextTeamName && teamsData.length > 0) {
                nextTeamName = teamsData[0].teamName;
            }

            setSelectedTeamName(nextTeamName);

            if (nextTeamName) {
                const details = await fetchTeamDetails(nextTeamName);
                setSelectedTeam(details);
            } else {
                setSelectedTeam(null);
            }
        } catch (error) {
            if (isUnauthorizedError(error)) {
                setIsAuthenticated(false);
                setCurrentUser(null);
                setTeams([]);
                setInvitations([]);
                setSelectedTeamName(null);
                setSelectedTeam(null);
                return;
            }

            setTeamError(readApiErrorMessage(error));
        } finally {
            setTeamLoading(false);
        }
    };

    const loadProfileData = async () => {
        setProfileLoading(true);
        setProfileError(null);

        try {
            const [profile, keys] = await Promise.all([fetchCurrentUser(), fetchSshKeys()]);
            setCurrentUser(profile);
            setSshKeys(keys);
        } catch (error) {
            if (isUnauthorizedError(error)) {
                setIsAuthenticated(false);
                setCurrentUser(null);
                setSshKeys([]);
                return;
            }

            setProfileError(readApiErrorMessage(error));
        } finally {
            setProfileLoading(false);
        }
    };

    const handleLogin = async (credentials: AuthCredentials) => {
        setAuthError(null);
        setAuthLoading(true);
        try {
            await loginUser(credentials);
            const profile = await fetchCurrentUser();
            setCurrentUser(profile);
            setIsAuthenticated(true);
            setLoading(true);
            await loadData();
        } catch (error) {
            setAuthError(readApiErrorMessage(error));
            setIsAuthenticated(false);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleRegister = async (payload: RegisterPayload) => {
        setAuthError(null);
        setAuthLoading(true);
        try {
            await registerUser(payload);
            const profile = await fetchCurrentUser();
            setCurrentUser(profile);
            setIsAuthenticated(true);
            setLoading(true);
            await loadData();
        } catch (error) {
            setAuthError(readApiErrorMessage(error));
            setIsAuthenticated(false);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogout = async () => {
        setAuthError(null);
        try {
            await logoutUser();
        } catch (error) {
            console.error("Logout failed:", error);
        } finally {
            setCurrentUser(null);
            setIsAuthenticated(false);
            setActivities([]);
            setPatches([]);
            setRepositories([]);
            setTeams([]);
            setInvitations([]);
            setSelectedTeamName(null);
            setSelectedTeam(null);
            setSshKeys([]);
            setSelectedPatchId(null);
            setIsDiffDrawerOpen(false);
            setIsFullscreenDiffOpen(false);
            setLoading(false);
        }
    };

    const handleCreateTeam = async (teamName: string) => {
        setTeamError(null);
        setTeamActionMessage(null);

        try {
            await createTeam(teamName);
            setTeamActionMessage(`Team ${teamName} created.`);
            await loadCollaborationData(teamName);
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleSelectTeam = async (teamName: string) => {
        setSelectedTeamName(teamName);
        await loadCollaborationData(teamName);
    };

    const handleInviteMember = async (usernameOrEmail: string) => {
        if (!selectedTeamName) {
            return;
        }

        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await inviteTeamMember(selectedTeamName, usernameOrEmail);
            setTeamActionMessage(`Invite sent to ${usernameOrEmail}.`);
            await loadCollaborationData(selectedTeamName);
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleAcceptInvitation = async (teamName: string) => {
        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await acceptInvitation(teamName);
            setTeamActionMessage(`Joined ${teamName}.`);
            await loadCollaborationData(teamName);
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleDeclineInvitation = async (teamName: string) => {
        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await leaveOrDeclineTeam(teamName);
            setTeamActionMessage(`Declined invitation to ${teamName}.`);
            await loadCollaborationData(selectedTeamName ?? undefined);
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleLeaveTeam = async (teamName: string) => {
        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await leaveOrDeclineTeam(teamName);
            setTeamActionMessage(`Left ${teamName}.`);
            await loadCollaborationData();
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleDeleteTeam = async (teamName: string) => {
        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await deleteTeam(teamName);
            setTeamActionMessage(`Deleted ${teamName}.`);
            await loadCollaborationData();
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleToggleSharing = async (teamName: string, enabled: boolean) => {
        setTeamError(null);
        setTeamActionMessage(null);
        try {
            await toggleTeamSharing(teamName, enabled);
            setTeamActionMessage(
                enabled ? `Sharing enabled for ${teamName}.` : `Sharing disabled for ${teamName}.`,
            );
            await loadCollaborationData(teamName);
        } catch (error) {
            setTeamError(readApiErrorMessage(error));
        }
    };

    const handleProfileUpdate = async (payload: ProfileUpdatePayload, successMessage: string) => {
        setProfileError(null);
        setProfileActionMessage(null);

        try {
            await updateCurrentUserProfile(payload);
            setProfileActionMessage(successMessage);
            await loadProfileData();
        } catch (error) {
            setProfileError(readApiErrorMessage(error));
        }
    };

    const handleAddSshKey = async (label: string, publicKey: string) => {
        setProfileError(null);
        setProfileActionMessage(null);

        try {
            await addSshKey(label, publicKey);
            setProfileActionMessage(`Added SSH key ${label}.`);
            await loadProfileData();
        } catch (error) {
            setProfileError(readApiErrorMessage(error));
        }
    };

    const handleDeleteSshKey = async (id: number) => {
        setProfileError(null);
        setProfileActionMessage(null);

        try {
            await deleteSshKey(id);
            setProfileActionMessage("SSH key removed.");
            await loadProfileData();
        } catch (error) {
            setProfileError(readApiErrorMessage(error));
        }
    };

    const openPatch = (patchId: string) => {
        setSelectedPatchId(patchId);
        setIsDiffDrawerOpen(true);
    };

    const coreNavigationEntries: NavigationEntry[] = [
        {
            label: "Product site",
            href: "/",
            icon: ArticleIcon,
        },
        {
            label: "Operations workspace",
            href: "/dashboard",
            icon: DashboardCustomizeIcon,
        },
        {
            label: "Teams and sharing",
            href: "/teams",
            icon: GroupIcon,
        },
        {
            label: "Private profile",
            href: "/profile",
            icon: ManageAccountsIcon,
        },
        {
            label: "Download VSIX",
            href: "/downloads/work-share.vsix",
            icon: DownloadIcon,
        },
    ];

    const landingSections: NavigationEntry[] = [
        {
            label: "Install guide",
            href: "#install-guide",
            icon: CheckCircleOutlineIcon,
        },
        {
            label: "Capabilities",
            href: "#capabilities",
            icon: HubIcon,
        },
        {
            label: "Live preview",
            href: "#live-preview",
            icon: InsightsIcon,
        },
    ];

    const dashboardSections: NavigationEntry[] = [
        {
            label: "Repository tree",
            href: "#repository-tree",
            icon: LanIcon,
        },
        {
            label: "People focus",
            href: "#people-focus",
            icon: PersonSearchIcon,
        },
        {
            label: "Activity log",
            href: "#activity-log",
            icon: InsightsIcon,
        },
        {
            label: "Patch stream",
            href: "#patch-stream",
            icon: DifferenceIcon,
        },
    ];

    const teamSections: NavigationEntry[] = [
        {
            label: "Team overview",
            href: "#teams-overview",
            icon: GroupIcon,
        },
        {
            label: "Invitations",
            href: "#invitations",
            icon: GroupAddIcon,
        },
        {
            label: "Sharing controls",
            href: "#sharing-controls",
            icon: HubIcon,
        },
    ];

    const profileSections: NavigationEntry[] = [
        {
            label: "Account",
            href: "#profile-account",
            icon: ManageAccountsIcon,
        },
        {
            label: "Password",
            href: "#profile-password",
            icon: HubIcon,
        },
        {
            label: "SSH keys",
            href: "#profile-ssh-keys",
            icon: GroupAddIcon,
        },
    ];

    const sectionEntries =
        isDashboardRoute ? dashboardSections
        : isTeamsRoute ? teamSections
        : isProfileRoute ? profileSections
        : landingSections;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box className='app-shell'>
                <Box component='header' className='topbar'>
                    <Toolbar className='topbar-inner'>
                        <IconButton
                            color='inherit'
                            edge='start'
                            aria-label='Open navigation'
                            onClick={() => setIsNavigationDrawerOpen(true)}
                            sx={{ mr: 1.5 }}>
                            <MenuIcon />
                        </IconButton>
                        <ShareIcon sx={{ mr: 2 }} />
                        <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
                            Work Share
                        </Typography>
                        {isAuthenticated && currentUser ?
                            <Chip size='small' color='secondary' label={`Signed in as ${currentUser.username}`} />
                        :   null}
                        {isAuthenticated ?
                            <Button color='inherit' onClick={() => void handleLogout()} sx={{ ml: 1.5 }}>
                                Logout
                            </Button>
                        :   <Button
                                color='inherit'
                                href={isLandingRoute ? '/#install-guide' : currentPath}
                                variant='outlined'
                                sx={{ ml: 1.5 }}>
                                Login / Register
                            </Button>}
                        {!isDashboardRoute && <Button color='inherit' href='/dashboard'>Operations workspace</Button>}
                        {!isTeamsRoute && <Button color='inherit' href='/teams'>Teams</Button>}
                        {!isProfileRoute && <Button color='inherit' href='/profile'>Profile</Button>}
                        {!isLandingRoute && <Button color='inherit' href='/'>Product site</Button>}
                    </Toolbar>
                </Box>

                <Drawer anchor='left' open={isNavigationDrawerOpen} onClose={() => setIsNavigationDrawerOpen(false)}>
                    <Box className='navigation-drawer'>
                        <Box className='navigation-drawer-header'>
                            <Typography variant='h6'>Navigate</Typography>
                            <IconButton onClick={() => setIsNavigationDrawerOpen(false)} aria-label='Close navigation'>
                                <CloseIcon />
                            </IconButton>
                        </Box>
                        <Divider />

                        <Box className='navigation-section'>
                            <Typography variant='overline' color='text.secondary'>
                                Pages
                            </Typography>
                            <List disablePadding>
                                {coreNavigationEntries.map((entry) => {
                                    const Icon = entry.icon;
                                    return (
                                        <ListItemButton
                                            key={entry.label}
                                            component='a'
                                            href={entry.href}
                                            onClick={() => setIsNavigationDrawerOpen(false)}
                                            className='navigation-item'>
                                            <ListItemIcon>
                                                <Icon fontSize='small' />
                                            </ListItemIcon>
                                            <ListItemText primary={entry.label} />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </Box>

                        <Divider />

                        <Box className='navigation-section'>
                            <Typography variant='overline' color='text.secondary'>
                                {isDashboardRoute || isTeamsRoute || isProfileRoute ?
                                    "Workspace sections"
                                :   "Product sections"}
                            </Typography>
                            <List disablePadding>
                                {sectionEntries.map((entry) => {
                                    const Icon = entry.icon;
                                    return (
                                        <ListItemButton
                                            key={entry.label}
                                            component='a'
                                            href={entry.href}
                                            onClick={() => setIsNavigationDrawerOpen(false)}
                                            className='navigation-item'>
                                            <ListItemIcon>
                                                <Icon fontSize='small' />
                                            </ListItemIcon>
                                            <ListItemText primary={entry.label} />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </Box>
                    </Box>
                </Drawer>

                <Container maxWidth='xl' sx={{ mt: 4, mb: 6, flex: 1 }}>
                    {isDashboardRoute ?
                        isAuthenticated ?
                            <DashboardPage
                                loading={loading}
                                activityFeed={activityFeed}
                                dashboardMetrics={dashboardMetrics}
                                featuredPatches={featuredPatches}
                                openPatch={openPatch}
                                repositorySummaries={repositorySummaries}
                                repositoryTree={repositoryTree}
                                userSummaries={userSummaries}
                                selectedPatchId={selectedPatchId}
                            />
                        :   <DashboardAuthGate
                                authLoading={authLoading}
                                authError={authError}
                                onLogin={handleLogin}
                                onRegister={handleRegister}
                            />
                    : isTeamsRoute ?
                        isAuthenticated ?
                            <TeamManagementPage
                                teams={teams}
                                invitations={invitations}
                                selectedTeamName={selectedTeamName}
                                selectedTeam={selectedTeam}
                                currentUser={currentUser}
                                teamLoading={teamLoading}
                                teamError={teamError}
                                teamActionMessage={teamActionMessage}
                                onCreateTeam={handleCreateTeam}
                                onSelectTeam={handleSelectTeam}
                                onInviteMember={handleInviteMember}
                                onAcceptInvitation={handleAcceptInvitation}
                                onDeclineInvitation={handleDeclineInvitation}
                                onLeaveTeam={handleLeaveTeam}
                                onDeleteTeam={handleDeleteTeam}
                                onToggleSharing={handleToggleSharing}
                            />
                        :   <DashboardAuthGate
                                authLoading={authLoading}
                                authError={authError}
                                onLogin={handleLogin}
                                onRegister={handleRegister}
                                title='Login required for team management'
                                description='Team membership, invitations, and sharing controls are available to authenticated teammates only.'
                            />
                    : isProfileRoute ?
                        isAuthenticated ?
                            <ProfileManagementPage
                                currentUser={currentUser}
                                profileLoading={profileLoading}
                                profileError={profileError}
                                profileActionMessage={profileActionMessage}
                                sshKeys={sshKeys}
                                onSaveProfile={async (payload) =>
                                    handleProfileUpdate(payload, "Profile details updated.")
                                }
                                onChangePassword={async (payload) =>
                                    handleProfileUpdate(payload, "Password changed successfully.")
                                }
                                onAddSshKey={handleAddSshKey}
                                onDeleteSshKey={handleDeleteSshKey}
                            />
                        :   <DashboardAuthGate
                                authLoading={authLoading}
                                authError={authError}
                                onLogin={handleLogin}
                                onRegister={handleRegister}
                                title='Login required for private profile'
                                description='Profile details, password changes, and SSH key management are private to your account.'
                            />
                    :   <LandingPage
                            activityFeed={isAuthenticated ? activityFeed.slice(0, 18) : []}
                            dashboardMetrics={dashboardMetrics}
                            userSummaries={isAuthenticated ? userSummaries.slice(0, 8) : []}
                            vsixInfo={vsixInfo}
                            isAuthenticated={isAuthenticated}
                            currentUser={currentUser}
                            authLoading={authLoading}
                            authError={authError}
                            onLogin={handleLogin}
                            onRegister={handleRegister}
                            onLogout={handleLogout}
                        />
                    }
                </Container>

                <Box component='footer' className='footer-shell'>
                    <Container maxWidth='lg'>
                        <Typography variant='body2' color='text.secondary' align='center'>
                            Work Share aligns extension distribution, repository visibility, and patch review in one
                            place.
                        </Typography>
                        <Typography variant='body2' color='text.secondary' align='center' sx={{ mt: 1 }}>
                            <Link underline='hover' color='inherit' href='/downloads/work-share.vsix'>
                                VSIX download
                            </Link>
                            {" · "}
                            <Link underline='hover' color='inherit' href={isAuthenticated ? '/dashboard' : '/'}>
                                Live workspace
                            </Link>
                            {" · "}
                            <Link underline='hover' color='inherit' href={isAuthenticated ? '/teams' : '/'}>
                                Team settings
                            </Link>
                            {" · "}
                            <Link underline='hover' color='inherit' href={isAuthenticated ? '/profile' : '/'}>
                                Private profile
                            </Link>
                        </Typography>
                    </Container>
                </Box>

                <Drawer anchor='right' open={isDiffDrawerOpen} onClose={() => setIsDiffDrawerOpen(false)}>
                    <Box className='diff-drawer'>
                        <Box className='diff-toolbar'>
                            <Box>
                                <Typography variant='h6'>{selectedPatch?.fileName ?? "No patch selected"}</Typography>
                                <Typography variant='body2' color='text.secondary'>
                                    {selectedPatch ?
                                        `${selectedPatch.repositoryName} · ${selectedPatch.patch.userName} · ${selectedPatch.variantLabel}`
                                    :   "Select a patch from the repository tree or patch stream."}
                                </Typography>
                            </Box>
                            <Stack direction='row' spacing={1}>
                                <IconButton onClick={() => setIsFullscreenDiffOpen(true)} disabled={!selectedPatch}>
                                    <FullscreenIcon />
                                </IconButton>
                                <IconButton onClick={() => setIsDiffDrawerOpen(false)}>
                                    <CloseIcon />
                                </IconButton>
                            </Stack>
                        </Box>
                        <Divider />
                        <DiffContent patch={selectedPatch?.patch ?? null} />
                    </Box>
                </Drawer>

                <Dialog fullScreen open={isFullscreenDiffOpen} onClose={() => setIsFullscreenDiffOpen(false)}>
                    <Box className='fullscreen-shell'>
                        <Box className='diff-toolbar'>
                            <Box>
                                <Typography variant='h5'>{selectedPatch?.fileName ?? "No patch selected"}</Typography>
                                <Typography variant='body2' color='text.secondary'>
                                    {selectedPatch ?
                                        `${selectedPatch.repositoryName} · ${selectedPatch.patch.userName}`
                                    :   ""}
                                </Typography>
                            </Box>
                            <IconButton onClick={() => setIsFullscreenDiffOpen(false)}>
                                <CloseIcon />
                            </IconButton>
                        </Box>
                        <DialogContent sx={{ p: 0, flex: 1 }}>
                            <DiffContent patch={selectedPatch?.patch ?? null} fullscreen />
                        </DialogContent>
                    </Box>
                </Dialog>
            </Box>
        </ThemeProvider>
    );
}

function readApiErrorMessage(error: unknown): string {
    const genericMessage = "Request failed. Please verify your details and try again.";
    if (!error || typeof error !== "object") {
        return genericMessage;
    }

    const maybeResponse = (error as { response?: { data?: { error?: unknown } } }).response;
    if (typeof maybeResponse?.data?.error === "string" && maybeResponse.data.error.trim()) {
        return maybeResponse.data.error;
    }

    const maybeMessage = (error as { message?: unknown }).message;
    return typeof maybeMessage === "string" && maybeMessage.trim() ? maybeMessage : genericMessage;
}

function AuthPanel({
    authLoading,
    authError,
    currentUser,
    isAuthenticated,
    onLogin,
    onLogout,
    onRegister,
}: {
    authLoading: boolean;
    authError: string | null;
    currentUser: AuthUserProfile | null;
    isAuthenticated: boolean;
    onLogin: (payload: AuthCredentials) => Promise<void>;
    onLogout: () => Promise<void>;
    onRegister: (payload: RegisterPayload) => Promise<void>;
}) {
    const [mode, setMode] = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");

    const submit = async () => {
        if (mode === "login") {
            await onLogin({ username: username.trim(), password });
            return;
        }

        await onRegister({
            username: username.trim(),
            password,
            fullName: fullName.trim(),
            email: email.trim(),
        });
    };

    if (isAuthenticated && currentUser) {
        return (
            <Stack spacing={1.5}>
                <Alert severity='success'>Authenticated as {currentUser.username}.</Alert>
                <Button variant='outlined' onClick={() => void onLogout()}>
                    Logout
                </Button>
            </Stack>
        );
    }

    return (
        <Stack spacing={1.5}>
            <Stack direction='row' spacing={1}>
                <Button
                    variant={mode === "login" ? "contained" : "outlined"}
                    onClick={() => setMode("login")}
                    disabled={authLoading}>
                    Login
                </Button>
                <Button
                    variant={mode === "register" ? "contained" : "outlined"}
                    onClick={() => setMode("register")}
                    disabled={authLoading}>
                    Create account
                </Button>
            </Stack>

            <TextField
                label='Username'
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete='username'
                required
                fullWidth
                size='small'
            />

            {mode === "register" ?
                <TextField
                    label='Full name'
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete='name'
                    required
                    fullWidth
                    size='small'
                />
            :   null}

            {mode === "register" ?
                <TextField
                    label='Email'
                    type='email'
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete='email'
                    required
                    fullWidth
                    size='small'
                />
            :   null}

            <TextField
                label='Password'
                type='password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                fullWidth
                size='small'
            />

            <Button variant='contained' disabled={authLoading} onClick={() => void submit()}>
                {authLoading ? "Working..." : mode === "login" ? "Login" : "Create account"}
            </Button>

            {authError ? <Alert severity='error'>{authError}</Alert> : null}
        </Stack>
    );
}

function DashboardAuthGate({
    authLoading,
    authError,
    onLogin,
    onRegister,
    title = "Login required for dashboard data",
    description = "Repository, user, activity, and patch streams are restricted to authenticated teammates.",
}: {
    authLoading: boolean;
    authError: string | null;
    onLogin: (payload: AuthCredentials) => Promise<void>;
    onRegister: (payload: RegisterPayload) => Promise<void>;
    title?: string;
    description?: string;
}) {
    return (
        <Paper elevation={0} sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
            <Typography variant='h4'>{title}</Typography>
            <Typography variant='body1' color='text.secondary' sx={{ mt: 1, mb: 3 }}>
                {description}
            </Typography>
            <AuthPanel
                authLoading={authLoading}
                authError={authError}
                currentUser={null}
                isAuthenticated={false}
                onLogin={onLogin}
                onLogout={async () => {}}
                onRegister={onRegister}
            />
        </Paper>
    );
}

function TeamManagementPage({
    teams,
    invitations,
    selectedTeamName,
    selectedTeam,
    currentUser,
    teamLoading,
    teamError,
    teamActionMessage,
    onCreateTeam,
    onSelectTeam,
    onInviteMember,
    onAcceptInvitation,
    onDeclineInvitation,
    onLeaveTeam,
    onDeleteTeam,
    onToggleSharing,
}: {
    teams: TeamSummary[];
    invitations: TeamInvitation[];
    selectedTeamName: string | null;
    selectedTeam: TeamDetails | null;
    currentUser: AuthUserProfile | null;
    teamLoading: boolean;
    teamError: string | null;
    teamActionMessage: string | null;
    onCreateTeam: (teamName: string) => Promise<void>;
    onSelectTeam: (teamName: string) => Promise<void>;
    onInviteMember: (usernameOrEmail: string) => Promise<void>;
    onAcceptInvitation: (teamName: string) => Promise<void>;
    onDeclineInvitation: (teamName: string) => Promise<void>;
    onLeaveTeam: (teamName: string) => Promise<void>;
    onDeleteTeam: (teamName: string) => Promise<void>;
    onToggleSharing: (teamName: string, enabled: boolean) => Promise<void>;
}) {
    const [newTeamName, setNewTeamName] = useState("");
    const [inviteIdentity, setInviteIdentity] = useState("");

    const userMembership = selectedTeam?.members.find((member) => member.username === currentUser?.username) ?? null;
    const isOwner = selectedTeam?.ownerUsername === currentUser?.username;

    return (
        <Stack spacing={3}>
            <Paper className='ops-hero' elevation={0} id='teams-overview'>
                <Typography variant='overline' color='secondary.main'>
                    Team workspace
                </Typography>
                <Typography variant='h3' sx={{ mt: 1 }}>
                    Manage teams, invitations, and sharing scopes.
                </Typography>
                <Typography variant='body1' color='text.secondary' sx={{ mt: 2, maxWidth: 840 }}>
                    Dedicated controls for creating teams, inviting members, and toggling per-team sharing in line with
                    the Work Share visibility model.
                </Typography>
            </Paper>

            {teamError && <Alert severity='error'>{teamError}</Alert>}
            {teamActionMessage && <Alert severity='success'>{teamActionMessage}</Alert>}

            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'minmax(320px, 0.9fr) minmax(0, 1.6fr)' } }}>
                <Stack spacing={3}>
                    <Paper className='workspace-panel' elevation={0}>
                        <SectionHeader
                            title='Your teams'
                            detail='Select a team to inspect members and sharing status.'
                        />
                        {teams.length === 0 ?
                            <Alert severity='info'>No active teams yet. Create one to start coordinating sharing.</Alert>
                        :   <List disablePadding>
                                {teams.map((team) => (
                                    <ListItemButton
                                        key={team.teamName}
                                        className='feed-row'
                                        selected={team.teamName === selectedTeamName}
                                        onClick={() => void onSelectTeam(team.teamName)}>
                                        <ListItemText
                                            primary={team.teamName}
                                            secondary={`${team.memberCount} members · owner ${team.ownerUsername}`}
                                        />
                                        {team.isOwner && <Chip size='small' label='Owner' color='secondary' />}
                                    </ListItemButton>
                                ))}
                            </List>}

                        <Divider sx={{ my: 2.5 }} />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                            <TextField
                                fullWidth
                                size='small'
                                label='New team name'
                                value={newTeamName}
                                onChange={(event) => setNewTeamName(event.target.value)}
                            />
                            <Button
                                variant='contained'
                                onClick={async () => {
                                    const normalized = newTeamName.trim();
                                    if (!normalized) {
                                        return;
                                    }
                                    await onCreateTeam(normalized);
                                    setNewTeamName('');
                                }}>
                                Create team
                            </Button>
                        </Stack>
                    </Paper>

                    <Paper className='workspace-panel' elevation={0} id='invitations'>
                        <SectionHeader
                            title='Invitations'
                            detail='Accept or decline incoming team invites.'
                        />
                        {invitations.length === 0 ?
                            <Alert severity='info'>No pending invitations.</Alert>
                        :   <Stack spacing={1.5}>
                                {invitations.map((invite) => (
                                    <Paper key={`${invite.teamName}:${invite.invitedAt}`} className='focus-row' elevation={0}>
                                        <Box>
                                            <Typography variant='subtitle1'>{invite.teamName}</Typography>
                                            <Typography variant='body2' color='text.secondary'>
                                                Owner {invite.ownerUsername} · invited {formatRelativeTime(invite.invitedAt)}
                                            </Typography>
                                        </Box>
                                        <Stack direction='row' spacing={1}>
                                            <Button
                                                size='small'
                                                variant='contained'
                                                onClick={() => void onAcceptInvitation(invite.teamName)}>
                                                Accept
                                            </Button>
                                            <Button
                                                size='small'
                                                variant='outlined'
                                                color='inherit'
                                                onClick={() => void onDeclineInvitation(invite.teamName)}>
                                                Decline
                                            </Button>
                                        </Stack>
                                    </Paper>
                                ))}
                            </Stack>}
                    </Paper>
                </Stack>

                <Paper className='workspace-panel' elevation={0} id='sharing-controls'>
                    <SectionHeader
                        title={selectedTeam ? `Team details: ${selectedTeam.teamName}` : 'Select a team'}
                        detail='Review membership, invite additional people, and configure your sharing state for this team.'
                    />

                    {teamLoading && <CircularProgress size={24} sx={{ mb: 2 }} />}

                    {!selectedTeam ?
                        <Alert severity='info'>Choose a team from the left panel to manage sharing and members.</Alert>
                    :   <Stack spacing={2}>
                            <Paper className='focus-row' elevation={0}>
                                <Box>
                                    <Typography variant='subtitle1'>Owner</Typography>
                                    <Typography variant='body2' color='text.secondary'>
                                        {selectedTeam.ownerUsername}
                                    </Typography>
                                </Box>
                                <Typography variant='body2' color='text.secondary'>
                                    Created {formatRelativeTime(selectedTeam.createdAt)}
                                </Typography>
                            </Paper>

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={Boolean(userMembership?.sharingEnabled)}
                                        onChange={(_, checked) => void onToggleSharing(selectedTeam.teamName, checked)}
                                        disabled={!userMembership}
                                    />
                                }
                                label={
                                    userMembership?.sharingEnabled ?
                                        'Sharing enabled for this team'
                                    :   'Sharing disabled for this team'
                                }
                            />
                            {!userMembership?.sharingEnabled && userMembership?.disabledAt && (
                                <Typography variant='body2' color='text.secondary'>
                                    Sharing disabled {formatRelativeTime(userMembership.disabledAt)}.
                                </Typography>
                            )}

                            <Divider />

                            {isOwner && (
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                    <TextField
                                        fullWidth
                                        size='small'
                                        label='Invite by username or email'
                                        value={inviteIdentity}
                                        onChange={(event) => setInviteIdentity(event.target.value)}
                                    />
                                    <Button
                                        variant='contained'
                                        onClick={async () => {
                                            const value = inviteIdentity.trim();
                                            if (!value) {
                                                return;
                                            }
                                            await onInviteMember(value);
                                            setInviteIdentity('');
                                        }}>
                                        Invite member
                                    </Button>
                                </Stack>
                            )}

                            <Stack spacing={1.25}>
                                {selectedTeam.members.map((member) => (
                                    <Paper key={member.username} className='focus-row' elevation={0}>
                                        <Box>
                                            <Typography variant='subtitle1'>{member.fullName || member.username}</Typography>
                                            <Typography variant='body2' color='text.secondary'>
                                                @{member.username} · {member.status}
                                            </Typography>
                                        </Box>
                                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                            <Chip
                                                size='small'
                                                label={member.sharingEnabled ? 'Sharing on' : 'Sharing off'}
                                                color={member.sharingEnabled ? 'success' : 'default'}
                                            />
                                            {member.username === selectedTeam.ownerUsername && (
                                                <Chip size='small' label='Owner' color='secondary' />
                                            )}
                                        </Stack>
                                    </Paper>
                                ))}
                            </Stack>

                            <Divider />

                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                {!isOwner && (
                                    <Button
                                        variant='outlined'
                                        color='warning'
                                        onClick={() => void onLeaveTeam(selectedTeam.teamName)}>
                                        Leave team
                                    </Button>
                                )}
                                {isOwner && (
                                    <Button
                                        variant='outlined'
                                        color='error'
                                        onClick={() => void onDeleteTeam(selectedTeam.teamName)}>
                                        Delete team
                                    </Button>
                                )}
                            </Stack>
                        </Stack>}
                </Paper>
            </Box>
        </Stack>
    );
}

function ProfileManagementPage({
    currentUser,
    profileLoading,
    profileError,
    profileActionMessage,
    sshKeys,
    onSaveProfile,
    onChangePassword,
    onAddSshKey,
    onDeleteSshKey,
}: {
    currentUser: AuthUserProfile | null;
    profileLoading: boolean;
    profileError: string | null;
    profileActionMessage: string | null;
    sshKeys: SshKeyEntry[];
    onSaveProfile: (payload: ProfileUpdatePayload) => Promise<void>;
    onChangePassword: (payload: ProfileUpdatePayload) => Promise<void>;
    onAddSshKey: (label: string, publicKey: string) => Promise<void>;
    onDeleteSshKey: (id: number) => Promise<void>;
}) {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [sshLabel, setSshLabel] = useState("");
    const [sshPublicKey, setSshPublicKey] = useState("");
    const [localPasswordError, setLocalPasswordError] = useState<string | null>(null);

    useEffect(() => {
        setFullName(currentUser?.fullName ?? "");
        setEmail(currentUser?.email ?? "");
    }, [currentUser]);

    return (
        <Stack spacing={3}>
            <Paper className='ops-hero' elevation={0}>
                <Typography variant='overline' color='secondary.main'>
                    Private profile
                </Typography>
                <Typography variant='h3' sx={{ mt: 1 }}>
                    Manage your account details and credentials.
                </Typography>
                <Typography variant='body1' color='text.secondary' sx={{ mt: 2, maxWidth: 840 }}>
                    This page is private to your signed-in account and controls profile fields, password updates, and
                    SSH keys used across your Work Share setup.
                </Typography>
            </Paper>

            {profileError && <Alert severity='error'>{profileError}</Alert>}
            {profileActionMessage && <Alert severity='success'>{profileActionMessage}</Alert>}
            {profileLoading && <CircularProgress size={24} />}

            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}>
                <Paper className='workspace-panel' elevation={0} id='profile-account'>
                    <SectionHeader title='Account details' detail='Update your display name and email address.' />
                    <Stack spacing={1.5}>
                        <TextField
                            label='Username'
                            value={currentUser?.username ?? ''}
                            disabled
                            size='small'
                            fullWidth
                        />
                        <TextField
                            label='Full name'
                            value={fullName}
                            onChange={(event) => setFullName(event.target.value)}
                            size='small'
                            fullWidth
                        />
                        <TextField
                            label='Email'
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            type='email'
                            size='small'
                            fullWidth
                        />
                        <Button
                            variant='contained'
                            onClick={() =>
                                void onSaveProfile({
                                    fullName: fullName.trim(),
                                    email: email.trim(),
                                })
                            }>
                            Save profile
                        </Button>
                    </Stack>
                </Paper>

                <Paper className='workspace-panel' elevation={0} id='profile-password'>
                    <SectionHeader
                        title='Change password'
                        detail='Provide your current password and choose a new one.'
                    />
                    <Stack spacing={1.5}>
                        <TextField
                            label='Current password'
                            type='password'
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            size='small'
                            fullWidth
                        />
                        <TextField
                            label='New password'
                            type='password'
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            size='small'
                            fullWidth
                        />
                        <TextField
                            label='Confirm new password'
                            type='password'
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            size='small'
                            fullWidth
                        />
                        {localPasswordError && <Alert severity='warning'>{localPasswordError}</Alert>}
                        <Button
                            variant='contained'
                            onClick={async () => {
                                setLocalPasswordError(null);

                                if (!currentPassword || !newPassword) {
                                    setLocalPasswordError('Current password and new password are required.');
                                    return;
                                }

                                if (newPassword !== confirmPassword) {
                                    setLocalPasswordError('New password confirmation does not match.');
                                    return;
                                }

                                await onChangePassword({
                                    currentPassword,
                                    newPassword,
                                });

                                setCurrentPassword('');
                                setNewPassword('');
                                setConfirmPassword('');
                            }}>
                            Change password
                        </Button>
                    </Stack>
                </Paper>

                <Paper className='workspace-panel' elevation={0} id='profile-ssh-keys' sx={{ gridColumn: { xs: '1', lg: '1 / -1' } }}>
                    <SectionHeader
                        title='SSH keys'
                        detail='Register device keys with labels so they can be managed from your account.'
                    />
                    <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
                            <TextField
                                size='small'
                                label='Key label'
                                value={sshLabel}
                                onChange={(event) => setSshLabel(event.target.value)}
                                sx={{ minWidth: { lg: 240 } }}
                            />
                            <TextField
                                size='small'
                                label='Public key'
                                value={sshPublicKey}
                                onChange={(event) => setSshPublicKey(event.target.value)}
                                fullWidth
                            />
                            <Button
                                variant='contained'
                                onClick={async () => {
                                    const normalizedLabel = sshLabel.trim();
                                    const normalizedKey = sshPublicKey.trim();
                                    if (!normalizedLabel || !normalizedKey) {
                                        return;
                                    }
                                    await onAddSshKey(normalizedLabel, normalizedKey);
                                    setSshLabel('');
                                    setSshPublicKey('');
                                }}>
                                Add key
                            </Button>
                        </Stack>

                        {sshKeys.length === 0 ?
                            <Alert severity='info'>No SSH keys registered yet.</Alert>
                        :   <Stack spacing={1.25}>
                                {sshKeys.map((key) => (
                                    <Paper key={key.id} className='focus-row' elevation={0}>
                                        <Box sx={{ maxWidth: '75%' }}>
                                            <Typography variant='subtitle1'>{key.label}</Typography>
                                            <Typography
                                                variant='body2'
                                                color='text.secondary'
                                                sx={{ wordBreak: 'break-all' }}>
                                                {key.publicKey}
                                            </Typography>
                                        </Box>
                                        <Stack direction='row' spacing={1} alignItems='center'>
                                            <Typography variant='caption' color='text.secondary'>
                                                {formatRelativeTime(key.createdAt)}
                                            </Typography>
                                            <Button
                                                size='small'
                                                variant='outlined'
                                                color='error'
                                                onClick={() => void onDeleteSshKey(key.id)}>
                                                Remove
                                            </Button>
                                        </Stack>
                                    </Paper>
                                ))}
                            </Stack>}
                    </Stack>
                </Paper>
            </Box>
        </Stack>
    );
}

function LandingPage({
    activityFeed,
    dashboardMetrics,
    userSummaries,
    vsixInfo,
    isAuthenticated,
    currentUser,
    authLoading,
    authError,
    onLogin,
    onRegister,
    onLogout,
}: {
    activityFeed: ReturnType<typeof buildActivityFeed>;
    dashboardMetrics: ReturnType<typeof buildDashboardMetrics>;
    userSummaries: ReturnType<typeof buildUserSummaries>;
    vsixInfo: VsixInfo;
    isAuthenticated: boolean;
    currentUser: AuthUserProfile | null;
    authLoading: boolean;
    authError: string | null;
    onLogin: (payload: AuthCredentials) => Promise<void>;
    onRegister: (payload: RegisterPayload) => Promise<void>;
    onLogout: () => Promise<void>;
}) {
    return (
        <Stack spacing={4}>
            <Paper className='hero-shell' elevation={0}>
                <Box className='hero-grid'>
                    <Box>
                        <Chip className='eyebrow-chip' icon={<HubIcon />} label='Mixed product site + live workspace' />
                        <Typography variant='h2' sx={{ mt: 2, maxWidth: 700 }}>
                            Coordinate file ownership, patch review, and rollout from one shared surface.
                        </Typography>
                        <Typography variant='h6' color='text.secondary' sx={{ mt: 2, maxWidth: 720 }}>
                            Work Share turns raw repository activity into a usable operational view: who is touching
                            what, which diffs are moving, and how your team should install and adopt the extension.
                        </Typography>

                        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 4 }}>
                            <Button
                                variant='contained'
                                size='large'
                                href={isAuthenticated ? "/dashboard" : "#install-guide"}
                                endIcon={<ArrowOutwardIcon />}>
                                Open operations workspace
                            </Button>
                            <Button
                                variant='outlined'
                                size='large'
                                href={vsixInfo.downloadUrl ?? "/downloads/work-share.vsix"}
                                disabled={!vsixInfo.available}
                                startIcon={<DownloadIcon />}>
                                Download VSIX
                            </Button>
                        </Stack>

                        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 4 }}>
                            {dashboardMetrics.map((metric) => (
                                <Paper key={metric.label} className='metric-card' elevation={0}>
                                    <Typography variant='overline' color='text.secondary'>
                                        {metric.label}
                                    </Typography>
                                    <Typography variant='h4'>{metric.value}</Typography>
                                    <Typography variant='body2' color='text.secondary'>
                                        {metric.detail}
                                    </Typography>
                                </Paper>
                            ))}
                        </Stack>
                    </Box>

                    <Paper id='install-guide' className='install-card' elevation={0}>
                        <Typography variant='overline' color='secondary.main'>
                            Install and deploy
                        </Typography>
                        <Typography variant='h5' sx={{ mt: 1, mb: 2 }}>
                            Ship the extension without guesswork.
                        </Typography>
                        <Stack spacing={1.5}>
                            {INSTALL_STEPS.map((step, index) => (
                                <Box key={step} sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                                    <CheckCircleOutlineIcon color='primary' sx={{ mt: 0.2 }} />
                                    <Typography variant='body2'>
                                        {index + 1}. {step}
                                    </Typography>
                                </Box>
                            ))}
                        </Stack>

                        <Divider sx={{ my: 3 }} />

                        {vsixInfo.available && vsixInfo.fileName ?
                            <Alert severity='success'>Latest package ready: {vsixInfo.fileName}</Alert>
                        :   <Alert severity='info'>
                                {vsixInfo.message ?? "Package availability will appear here once a VSIX is built."}
                            </Alert>
                        }

                        <Typography variant='body2' color='text.secondary' sx={{ mt: 2 }}>
                            Need packaging? Run npm run package at the workspace root, then return here to verify the
                            downloadable build.
                        </Typography>

                        <Divider sx={{ my: 3 }} />

                        <Typography variant='overline' color='secondary.main'>
                            Access control
                        </Typography>
                        <Typography variant='h6' sx={{ mt: 1, mb: 1.5 }}>
                            {isAuthenticated && currentUser ?
                                `Signed in as ${currentUser.username}`
                            :   "Create an account or log in to access team streams."}
                        </Typography>
                        <AuthPanel
                            authLoading={authLoading}
                            authError={authError}
                            currentUser={currentUser}
                            isAuthenticated={isAuthenticated}
                            onLogin={onLogin}
                            onLogout={onLogout}
                            onRegister={onRegister}
                        />
                    </Paper>
                </Box>
            </Paper>

            <Box id='capabilities' className='callout-grid'>
                {CAPABILITY_CALLOUTS.map((callout) => {
                    const Icon = callout.icon;
                    return (
                        <Paper key={callout.title} className='callout-card' elevation={0}>
                            <Icon color='primary' sx={{ fontSize: 34 }} />
                            <Typography variant='h6' sx={{ mt: 2 }}>
                                {callout.title}
                            </Typography>
                            <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
                                {callout.detail}
                            </Typography>
                        </Paper>
                    );
                })}
            </Box>

            <Box id='live-preview' className='dashboard-preview-grid'>
                <Paper className='workspace-panel' elevation={0}>
                    <SectionHeader
                        title='Team focus snapshot'
                        detail='Use the live dashboard to see where people are currently investing effort.'
                    />
                    {isAuthenticated ?
                        <Stack spacing={1.5}>
                            {userSummaries.slice(0, 4).map((user) => (
                                <Paper key={user.name} className='focus-row' elevation={0}>
                                    <Box>
                                        <Typography variant='h6'>{user.name}</Typography>
                                        <Typography variant='body2' color='text.secondary'>
                                            {user.topRepository || "No repository yet"} ·{" "}
                                            {formatRelativeTime(user.lastSeen)}
                                        </Typography>
                                    </Box>
                                    <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                        <Chip size='small' label={`${user.fileCount} files`} />
                                        <Chip size='small' label={`${user.patchCount} patches`} color='secondary' />
                                    </Stack>
                                </Paper>
                            ))}
                        </Stack>
                    :   <Alert severity='info'>Login is required to view live teammate activity.</Alert>}
                </Paper>

                <Paper className='workspace-panel' elevation={0}>
                    <SectionHeader
                        title='Recent motion'
                        detail='A compact feed of activity and patch updates from the current server state.'
                    />
                    {isAuthenticated ?
                        <List disablePadding>
                            {activityFeed.slice(0, 6).map((item) => (
                                <ListItemButton key={item.id} className='feed-row' href='/dashboard'>
                                    <ListItemText
                                        primary={item.title}
                                        secondary={`${item.repositoryName} · ${item.filePath} · ${formatRelativeTime(item.timestamp)}`}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                    :   <Alert severity='info'>Activity and patch streams are hidden for unauthenticated users.</Alert>}
                </Paper>
            </Box>
        </Stack>
    );
}

function DashboardPage({
    activityFeed,
    dashboardMetrics,
    featuredPatches,
    loading,
    openPatch,
    repositorySummaries,
    repositoryTree,
    selectedPatchId,
    userSummaries,
}: {
    activityFeed: ReturnType<typeof buildActivityFeed>;
    dashboardMetrics: ReturnType<typeof buildDashboardMetrics>;
    featuredPatches: ReturnType<typeof buildFeaturedPatches>;
    loading: boolean;
    openPatch: (patchId: string) => void;
    repositorySummaries: ReturnType<typeof buildRepositorySummaries>;
    repositoryTree: ReturnType<typeof buildRepositoryTree>;
    selectedPatchId: string | null;
    userSummaries: ReturnType<typeof buildUserSummaries>;
}) {
    const repositoryPageSize = 8;
    const peoplePageSize = 12;
    const activityPageSize = 24;
    const patchPageSize = 24;
    const repositoryOverviewPageSize = 10;

    const [repositoryPage, setRepositoryPage] = useState(1);
    const [peoplePage, setPeoplePage] = useState(1);
    const [activityPage, setActivityPage] = useState(1);
    const [patchPage, setPatchPage] = useState(1);
    const [repositoryOverviewPage, setRepositoryOverviewPage] = useState(1);

    const repositoryPageCount = Math.max(1, Math.ceil(repositoryTree.length / repositoryPageSize));
    const peoplePageCount = Math.max(1, Math.ceil(userSummaries.length / peoplePageSize));
    const activityPageCount = Math.max(1, Math.ceil(activityFeed.length / activityPageSize));
    const patchPageCount = Math.max(1, Math.ceil(featuredPatches.length / patchPageSize));
    const repositoryOverviewPageCount = Math.max(1, Math.ceil(repositorySummaries.length / repositoryOverviewPageSize));

    useEffect(() => {
        setRepositoryPage((current) => Math.min(current, repositoryPageCount));
    }, [repositoryPageCount]);

    useEffect(() => {
        setPeoplePage((current) => Math.min(current, peoplePageCount));
    }, [peoplePageCount]);

    useEffect(() => {
        setActivityPage((current) => Math.min(current, activityPageCount));
    }, [activityPageCount]);

    useEffect(() => {
        setPatchPage((current) => Math.min(current, patchPageCount));
    }, [patchPageCount]);

    useEffect(() => {
        setRepositoryOverviewPage((current) => Math.min(current, repositoryOverviewPageCount));
    }, [repositoryOverviewPageCount]);

    const pagedRepositories = useMemo(() => {
        const start = (repositoryPage - 1) * repositoryPageSize;
        return repositoryTree.slice(start, start + repositoryPageSize);
    }, [repositoryPage, repositoryTree]);

    const pagedUsers = useMemo(() => {
        const start = (peoplePage - 1) * peoplePageSize;
        return userSummaries.slice(start, start + peoplePageSize);
    }, [peoplePage, userSummaries]);

    const pagedActivity = useMemo(() => {
        const start = (activityPage - 1) * activityPageSize;
        return activityFeed.slice(start, start + activityPageSize);
    }, [activityFeed, activityPage]);

    const pagedPatches = useMemo(() => {
        const start = (patchPage - 1) * patchPageSize;
        return featuredPatches.slice(start, start + patchPageSize);
    }, [featuredPatches, patchPage]);

    const pagedRepositorySummaries = useMemo(() => {
        const start = (repositoryOverviewPage - 1) * repositoryOverviewPageSize;
        return repositorySummaries.slice(start, start + repositoryOverviewPageSize);
    }, [repositoryOverviewPage, repositorySummaries]);

    if (loading) {
        return (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Stack spacing={3}>
            <Paper className='ops-hero' elevation={0}>
                <Box className='ops-hero-grid'>
                    <Box>
                        <Typography variant='overline' color='secondary.main'>
                            Operations workspace
                        </Typography>
                        <Typography variant='h3' sx={{ mt: 1 }}>
                            Follow repository state, people movement, and diff detail in one view.
                        </Typography>
                        <Typography variant='body1' color='text.secondary' sx={{ mt: 2, maxWidth: 760 }}>
                            This workspace is designed for quick triage: repository tree on the left, people and
                            activity in the middle, patch inspection on demand from the right.
                        </Typography>
                    </Box>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap='wrap' useFlexGap>
                        {dashboardMetrics.map((metric) => (
                            <Paper key={metric.label} className='metric-card compact' elevation={0}>
                                <Typography variant='overline' color='text.secondary'>
                                    {metric.label}
                                </Typography>
                                <Typography variant='h5'>{metric.value}</Typography>
                            </Paper>
                        ))}
                    </Stack>
                </Box>
            </Paper>

            <Box className='ops-layout'>
                <Paper id='repository-tree' className='workspace-panel explorer-panel' elevation={0}>
                    <SectionHeader
                        title='Repository tree'
                        detail='Browse active files and open their latest shared patch directly in the diff sidebar.'
                    />
                    <Stack spacing={1.5}>
                        {pagedRepositories.map((repository) => (
                            <Paper key={repository.repositoryRemoteUrl} className='tree-card' elevation={0}>
                                <Box className='tree-card-header'>
                                    <Box>
                                        <Typography variant='h6'>{repository.repositoryName}</Typography>
                                        <Typography variant='body2' color='text.secondary'>
                                            {repository.upstreamBranch || "No upstream selected"} ·{" "}
                                            {repository.fileCount} files
                                        </Typography>
                                    </Box>
                                    <Chip size='small' color='secondary' label={`${repository.patchCount} patches`} />
                                </Box>
                                <List disablePadding className='list-scroll region-files'>
                                    {repository.files.slice(0, 8).map((file) => {
                                        const latestPatch = file.patches[0];
                                        return (
                                            <ListItemButton
                                                key={`${repository.repositoryRemoteUrl}:${file.repositoryFilePath}`}
                                                className='tree-row'
                                                onClick={() => {
                                                    if (!latestPatch) {
                                                        return;
                                                    }
                                                    const patchMatch = featuredPatches.find(
                                                        (item) =>
                                                            item.patch.repositoryRemoteUrl ===
                                                                latestPatch.repositoryRemoteUrl &&
                                                            item.patch.repositoryFilePath ===
                                                                latestPatch.repositoryFilePath &&
                                                            item.patch.userName === latestPatch.userName &&
                                                            item.patch.timestamp === latestPatch.timestamp,
                                                    );
                                                    if (patchMatch) {
                                                        openPatch(patchMatch.id);
                                                    }
                                                }}>
                                                <ListItemText
                                                    primary={file.repositoryFileName}
                                                    secondary={`${file.activeUsers.join(", ") || "No active editors"} · ${formatRelativeTime(file.lastActivity)}`}
                                                />
                                                <Chip size='small' label={`${file.patchCount}`} />
                                            </ListItemButton>
                                        );
                                    })}
                                </List>
                            </Paper>
                        ))}
                    </Stack>
                    <ListPagination
                        page={repositoryPage}
                        pageCount={repositoryPageCount}
                        onChange={setRepositoryPage}
                    />
                </Paper>

                <Box className='workspace-column'>
                    <Paper id='people-focus' className='workspace-panel' elevation={0}>
                        <SectionHeader
                            title='Who is working on what'
                            detail='People-centric summaries built from activity and patch streams.'
                        />
                        <Box className='people-grid'>
                            {pagedUsers.map((user) => (
                                <Paper key={user.name} className='person-card' elevation={0}>
                                    <Typography variant='h6'>{user.name}</Typography>
                                    <Typography variant='body2' color='text.secondary'>
                                        Focused on {user.topRepository || "unknown repository"}
                                    </Typography>
                                    <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap sx={{ mt: 2 }}>
                                        <Chip size='small' label={`${user.repositoryCount} repos`} />
                                        <Chip size='small' label={`${user.fileCount} files`} />
                                        <Chip size='small' color='secondary' label={`${user.patchCount} patches`} />
                                    </Stack>
                                    <Typography
                                        variant='caption'
                                        color='text.secondary'
                                        sx={{ mt: 2, display: "block" }}>
                                        Last seen {formatRelativeTime(user.lastSeen)}
                                    </Typography>
                                </Paper>
                            ))}
                        </Box>
                        <ListPagination page={peoplePage} pageCount={peoplePageCount} onChange={setPeoplePage} />
                    </Paper>

                    <Paper id='activity-log' className='workspace-panel' elevation={0}>
                        <SectionHeader
                            title='Activity log'
                            detail='Recent updates across file activity, patch sharing, and repository motion.'
                        />
                        <List disablePadding className='list-scroll region-activity'>
                            {pagedActivity.map((item) => (
                                <ListItemButton
                                    key={item.id}
                                    className='feed-row'
                                    onClick={() => {
                                        if (item.type !== "patch") {
                                            return;
                                        }
                                        const patchMatch = featuredPatches.find(
                                            (patch) =>
                                                patch.patch.repositoryRemoteUrl === item.repositoryRemoteUrl &&
                                                patch.patch.repositoryFilePath === item.filePath &&
                                                patch.patch.userName === item.userName &&
                                                patch.patch.timestamp === item.timestamp,
                                        );
                                        if (patchMatch) {
                                            openPatch(patchMatch.id);
                                        }
                                    }}>
                                    <ListItemText
                                        primary={item.title}
                                        secondary={`${item.repositoryName} · ${item.filePath} · ${formatRelativeTime(item.timestamp)}`}
                                    />
                                    <Chip size='small' label={item.type === "patch" ? "Patch" : "Activity"} />
                                </ListItemButton>
                            ))}
                        </List>
                        <ListPagination page={activityPage} pageCount={activityPageCount} onChange={setActivityPage} />
                    </Paper>
                </Box>

                <Paper id='patch-stream' className='workspace-panel highlights-panel' elevation={0}>
                    <SectionHeader
                        title='Patch stream'
                        detail='Choose a patch to open it in the review sidebar or fullscreen diff mode.'
                    />
                    <Stack spacing={1.25} className='list-scroll region-patches'>
                        {pagedPatches.map((item) => (
                            <Paper
                                key={item.id}
                                className={`patch-list-card${selectedPatchId === item.id ? " selected" : ""}`}
                                elevation={0}>
                                <ListItemButton
                                    onClick={() => openPatch(item.id)}
                                    sx={{ borderRadius: 3, alignItems: "flex-start" }}>
                                    <ListItemText
                                        primary={item.fileName}
                                        secondary={`${item.repositoryName} · ${item.patch.userName} · ${item.variantLabel} · ${item.relativeTime}`}
                                    />
                                </ListItemButton>
                            </Paper>
                        ))}
                    </Stack>
                    <ListPagination page={patchPage} pageCount={patchPageCount} onChange={setPatchPage} />

                    <Divider sx={{ my: 3 }} />

                    <SectionHeader
                        title='Repository overview'
                        detail='High-level repository counts anchored to current file state.'
                    />
                    <Stack spacing={1.25}>
                        {pagedRepositorySummaries.map((repository) => (
                            <Paper key={repository.repositoryRemoteUrl} className='focus-row' elevation={0}>
                                <Box>
                                    <Typography variant='subtitle1'>{repository.repositoryName}</Typography>
                                    <Typography variant='body2' color='text.secondary'>
                                        {repository.activeUserCount} active users ·{" "}
                                        {formatRelativeTime(repository.lastActivity)}
                                    </Typography>
                                </Box>
                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                    <Chip size='small' label={`${repository.fileCount} files`} />
                                    <Chip size='small' color='secondary' label={`${repository.patchCount} patches`} />
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>
                    <ListPagination
                        page={repositoryOverviewPage}
                        pageCount={repositoryOverviewPageCount}
                        onChange={setRepositoryOverviewPage}
                    />
                </Paper>
            </Box>
        </Stack>
    );
}

function ListPagination({
    page,
    pageCount,
    onChange,
}: {
    page: number;
    pageCount: number;
    onChange: (page: number) => void;
}) {
    if (pageCount <= 1) {
        return null;
    }

    return (
        <Box className='list-pagination'>
            <Pagination
                count={pageCount}
                page={page}
                onChange={(_, nextPage) => onChange(nextPage)}
                size='small'
                siblingCount={1}
                boundaryCount={1}
                shape='rounded'
                color='primary'
            />
        </Box>
    );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
    return (
        <Box sx={{ mb: 2.5 }}>
            <Typography variant='h5'>{title}</Typography>
            <Typography variant='body2' color='text.secondary' sx={{ mt: 0.75 }}>
                {detail}
            </Typography>
        </Box>
    );
}

function DiffContent({ patch, fullscreen = false }: { patch: Patch | null; fullscreen?: boolean }) {
    if (!patch) {
        return (
            <Box className='empty-diff-state'>
                <InsightsIcon color='primary' sx={{ fontSize: 42 }} />
                <Typography variant='h6' sx={{ mt: 2 }}>
                    Select a patch to inspect the diff.
                </Typography>
                <Typography variant='body2' color='text.secondary' sx={{ mt: 1, maxWidth: 420, textAlign: "center" }}>
                    The sidebar is intended for quick review. Open fullscreen when you need more space for longer patch
                    sets.
                </Typography>
            </Box>
        );
    }

    const parsedLines = useMemo(() => parseUnifiedDiff(patch.patch), [patch.patch]);
    const addedLines = parsedLines.filter((line) => line.kind === "add").length;
    const removedLines = parsedLines.filter((line) => line.kind === "remove").length;

    return (
        <Box className={fullscreen ? "diff-surface fullscreen" : "diff-surface"}>
            <Box className='diff-meta'>
                <Chip size='small' label={patch.changeType ?? "patch"} color='primary' />
                {patch.workingState && <Chip size='small' label={patch.workingState} color='secondary' />}
                <Chip size='small' label={patch.commitShortSha ?? patch.baseCommit.slice(0, 8)} />
                {patch.upstreamBranch && <Chip size='small' label={patch.upstreamBranch} />}
                <Chip size='small' label={`+${addedLines}`} color='success' />
                <Chip size='small' label={`-${removedLines}`} color='error' />
            </Box>
            <Typography variant='body2' color='text.secondary' sx={{ mt: 2, mb: 2 }}>
                {patch.commitMessage || `Patch for ${extractFileName(patch.repositoryFilePath)}`}
            </Typography>
            <Box className='diff-pre diff-grid' role='table' aria-label='Patch diff'>
                {parsedLines.map((line, index) => (
                    <Box key={`diff-line-${index}`} className={`diff-row diff-row-${line.kind}`} role='row'>
                        <Box className='diff-line-number' role='cell'>
                            {line.oldLineNumber ?? ""}
                        </Box>
                        <Box className='diff-line-number' role='cell'>
                            {line.newLineNumber ?? ""}
                        </Box>
                        <Box className='diff-line-content' role='cell'>
                            {line.content || " "}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

type ParsedDiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

interface ParsedDiffLine {
    content: string;
    kind: ParsedDiffLineKind;
    oldLineNumber: number | null;
    newLineNumber: number | null;
}

function parseUnifiedDiff(patchText: string): ParsedDiffLine[] {
    const lines = patchText.split("\n");
    const parsed: ParsedDiffLine[] = [];
    let oldLineNumber = 0;
    let newLineNumber = 0;

    for (const line of lines) {
        if (line.startsWith("@@")) {
            const match = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
            if (match) {
                oldLineNumber = Number(match[1]);
                newLineNumber = Number(match[2]);
            }

            parsed.push({
                content: line,
                kind: "hunk",
                oldLineNumber: null,
                newLineNumber: null,
            });
            continue;
        }

        if (
            line.startsWith("diff --git") ||
            line.startsWith("index ") ||
            line.startsWith("---") ||
            line.startsWith("+++")
        ) {
            parsed.push({
                content: line,
                kind: "meta",
                oldLineNumber: null,
                newLineNumber: null,
            });
            continue;
        }

        if (line.startsWith("+") && !line.startsWith("+++")) {
            parsed.push({
                content: line,
                kind: "add",
                oldLineNumber: null,
                newLineNumber,
            });
            newLineNumber += 1;
            continue;
        }

        if (line.startsWith("-") && !line.startsWith("---")) {
            parsed.push({
                content: line,
                kind: "remove",
                oldLineNumber,
                newLineNumber: null,
            });
            oldLineNumber += 1;
            continue;
        }

        const hasLineNumberContext = oldLineNumber > 0 || newLineNumber > 0;
        parsed.push({
            content: line,
            kind: "context",
            oldLineNumber: hasLineNumberContext ? oldLineNumber : null,
            newLineNumber: hasLineNumberContext ? newLineNumber : null,
        });
        if (hasLineNumberContext) {
            oldLineNumber += 1;
            newLineNumber += 1;
        }
    }

    return parsed;
}

export default App;
