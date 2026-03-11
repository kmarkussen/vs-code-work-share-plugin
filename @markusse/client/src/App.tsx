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
    IconButton,
    Link,
    List,
    ListItemIcon,
    ListItemButton,
    ListItemText,
    Paper,
    Pagination,
    Stack,
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
    Fullscreen as FullscreenIcon,
    Hub as HubIcon,
    Insights as InsightsIcon,
    Lan as LanIcon,
    Menu as MenuIcon,
    PersonSearch as PersonSearchIcon,
    Share as ShareIcon,
} from "@mui/icons-material";
import { fetchActivities, fetchFiles, fetchPatches } from "./api";
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

const DASHBOARD_PATH = "/dashboard";

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
    const isDashboardRoute = window.location.pathname === DASHBOARD_PATH;
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

    useEffect(() => {
        void loadData();
        const interval = setInterval(() => {
            void loadData();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

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
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
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

    const sectionEntries = isDashboardRoute ? dashboardSections : landingSections;

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
                        {isDashboardRoute ?
                            <Button color='inherit' href='/'>
                                Product site
                            </Button>
                        :   <Button color='inherit' href='/dashboard'>
                                Operations workspace
                            </Button>
                        }
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
                                {isDashboardRoute ? "Workspace sections" : "Product sections"}
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
                    :   <LandingPage
                            activityFeed={activityFeed.slice(0, 18)}
                            dashboardMetrics={dashboardMetrics}
                            userSummaries={userSummaries.slice(0, 8)}
                            vsixInfo={vsixInfo}
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
                            <Link underline='hover' color='inherit' href='/dashboard'>
                                Live workspace
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

function LandingPage({
    activityFeed,
    dashboardMetrics,
    userSummaries,
    vsixInfo,
}: {
    activityFeed: ReturnType<typeof buildActivityFeed>;
    dashboardMetrics: ReturnType<typeof buildDashboardMetrics>;
    userSummaries: ReturnType<typeof buildUserSummaries>;
    vsixInfo: VsixInfo;
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
                            <Button variant='contained' size='large' href='/dashboard' endIcon={<ArrowOutwardIcon />}>
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
                </Paper>

                <Paper className='workspace-panel' elevation={0}>
                    <SectionHeader
                        title='Recent motion'
                        detail='A compact feed of activity and patch updates from the current server state.'
                    />
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
