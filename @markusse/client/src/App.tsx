import { useState, useEffect } from "react";
import {
    ThemeProvider,
    createTheme,
    CssBaseline,
    AppBar,
    Toolbar,
    Typography,
    Container,
    Box,
    Paper,
    Tabs,
    Tab,
    CircularProgress,
    Button,
    Stack,
    Divider,
    Alert,
} from "@mui/material";
import { Share as ShareIcon } from "@mui/icons-material";
import RepositoriesPanel from "./components/RepositoriesPanel";
import UsersPanel from "./components/UsersPanel";
import PatchesPanel from "./components/PatchesPanel";
import FilesPanel from "./components/FilesPanel";
import { Activity, Patch, RepositoryFiles, FileFocusTarget, PatchFocusTarget, UserRecentActivity } from "./types";
import { fetchActivities, fetchPatches, fetchFiles } from "./api";

const REPOSITORIES_TAB_INDEX = 0;
const FILES_TAB_INDEX = 1;
const USERS_TAB_INDEX = 2;
const PATCHES_TAB_INDEX = 3;
const DASHBOARD_PATH = "/dashboard";

interface VsixInfo {
    available: boolean;
    fileName?: string;
    downloadUrl?: string;
    message?: string;
}

const theme = createTheme({
    palette: {
        mode: "dark",
        primary: {
            main: "#2196f3",
        },
        secondary: {
            main: "#f50057",
        },
        background: {
            default: "#121212",
            paper: "#1e1e1e",
        },
    },
    typography: {
        fontFamily: [
            "-apple-system",
            "BlinkMacSystemFont",
            '"Segoe UI"',
            "Roboto",
            '"Helvetica Neue"',
            "Arial",
            "sans-serif",
        ].join(","),
    },
});

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div
            role='tabpanel'
            hidden={value !== index}
            id={`tabpanel-${index}`}
            aria-labelledby={`tab-${index}`}
            {...other}>
            {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
        </div>
    );
}

function App() {
    const isDashboardRoute = window.location.pathname === DASHBOARD_PATH;
    const [tabValue, setTabValue] = useState(0);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [patches, setPatches] = useState<Patch[]>([]);
    const [repositories, setRepositories] = useState<RepositoryFiles[]>([]);
    const [focusedFile, setFocusedFile] = useState<FileFocusTarget | null>(null);
    const [focusedPatch, setFocusedPatch] = useState<PatchFocusTarget | null>(null);
    const [loading, setLoading] = useState(true);
    const [vsixInfo, setVsixInfo] = useState<VsixInfo>({
        available: false,
        message: "Checking for available VSIX package...",
    });

    useEffect(() => {
        if (!isDashboardRoute) {
            setLoading(false);
            return;
        }

        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, [isDashboardRoute]);

    useEffect(() => {
        if (isDashboardRoute) {
            return;
        }

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
    }, [isDashboardRoute]);

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

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleRecentActivityClick = (activity: UserRecentActivity) => {
        if (activity.type === "patch") {
            setFocusedPatch({
                repositoryRemoteUrl: activity.repositoryRemoteUrl,
                filePath: activity.filePath,
                timestamp: activity.timestamp,
                userName: activity.userName,
            });
            setFocusedFile(null);
            setTabValue(PATCHES_TAB_INDEX);
            return;
        }

        setFocusedFile({
            repositoryRemoteUrl: activity.repositoryRemoteUrl,
            filePath: activity.filePath,
        });
        setFocusedPatch(null);
        setTabValue(FILES_TAB_INDEX);
    };

    const renderLandingPage = () => {
        return (
            <Paper elevation={2} sx={{ p: 4 }}>
                <Stack spacing={3}>
                    <Typography variant='h4'>Welcome to Work Share</Typography>
                    <Typography variant='body1' color='text.secondary'>
                        Work Share gives your team visibility into active files, shared patches, and potential conflicts
                        so everyone can coordinate work with less overlap.
                    </Typography>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                        <Button variant='contained' color='primary' href='/dashboard'>
                            Open Live Dashboard
                        </Button>
                        <Button
                            variant='outlined'
                            color='primary'
                            href={vsixInfo.downloadUrl ?? "/downloads/work-share.vsix"}
                            disabled={!vsixInfo.available}>
                            Download VS Code Extension (VSIX)
                        </Button>
                    </Stack>

                    {!vsixInfo.available && vsixInfo.message && <Alert severity='info'>{vsixInfo.message}</Alert>}

                    {vsixInfo.available && vsixInfo.fileName && (
                        <Alert severity='success'>Ready to download: {vsixInfo.fileName}</Alert>
                    )}

                    <Divider />

                    <Typography variant='h6'>Getting Started</Typography>
                    <Typography variant='body2' color='text.secondary'>
                        1. Download and install the VSIX extension in VS Code.
                    </Typography>
                    <Typography variant='body2' color='text.secondary'>
                        2. Configure workShare.apiServerUrl to point to this dashboard server.
                    </Typography>
                    <Typography variant='body2' color='text.secondary'>
                        3. Optionally set workShare.userName, or let Work Share use your git user.name.
                    </Typography>
                    <Typography variant='body2' color='text.secondary'>
                        4. Open the Work Share view in VS Code and enable sharing.
                    </Typography>

                    <Divider />

                    <Typography variant='h6'>What You Can Track</Typography>
                    <Typography variant='body2' color='text.secondary'>
                        • Repository and file-level team activity
                    </Typography>
                    <Typography variant='body2' color='text.secondary'>
                        • Recent user actions across repositories
                    </Typography>
                    <Typography variant='body2' color='text.secondary'>
                        • Shared patches and possible conflicts
                    </Typography>
                </Stack>
            </Paper>
        );
    };

    const renderDashboardPage = () => {
        if (loading) {
            return (
                <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
                    <CircularProgress />
                </Box>
            );
        }

        return (
            <Paper elevation={2}>
                <Tabs
                    value={tabValue}
                    onChange={handleTabChange}
                    indicatorColor='primary'
                    textColor='primary'
                    variant='fullWidth'>
                    <Tab label='Repositories' />
                    <Tab label='Files' />
                    <Tab label='Users' />
                    <Tab label='Patches' />
                </Tabs>

                <TabPanel value={tabValue} index={REPOSITORIES_TAB_INDEX}>
                    <RepositoriesPanel activities={activities} patches={patches} />
                </TabPanel>
                <TabPanel value={tabValue} index={FILES_TAB_INDEX}>
                    <FilesPanel repositories={repositories} focusedFile={focusedFile} />
                </TabPanel>
                <TabPanel value={tabValue} index={USERS_TAB_INDEX}>
                    <UsersPanel
                        activities={activities}
                        patches={patches}
                        onRecentActivityClick={handleRecentActivityClick}
                    />
                </TabPanel>
                <TabPanel value={tabValue} index={PATCHES_TAB_INDEX}>
                    <PatchesPanel patches={patches} focusedPatch={focusedPatch} />
                </TabPanel>
            </Paper>
        );
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
                <AppBar position='static' elevation={0}>
                    <Toolbar>
                        <ShareIcon sx={{ mr: 2 }} />
                        <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
                            Work Share Dashboard
                        </Typography>
                        {isDashboardRoute ?
                            <Button color='inherit' href='/'>
                                Documentation
                            </Button>
                        :   <Button color='inherit' href='/dashboard'>
                                Dashboard
                            </Button>
                        }
                    </Toolbar>
                </AppBar>

                <Container maxWidth='xl' sx={{ mt: 4, mb: 4, flex: 1 }}>
                    {isDashboardRoute ? renderDashboardPage() : renderLandingPage()}
                </Container>

                <Box
                    component='footer'
                    sx={{
                        py: 3,
                        px: 2,
                        mt: "auto",
                        backgroundColor: (theme) => theme.palette.background.paper,
                    }}>
                    <Container maxWidth='sm'>
                        <Typography variant='body2' color='text.secondary' align='center'>
                            Work Share - Real-time collaboration tracking
                        </Typography>
                    </Container>
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
