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
    const [tabValue, setTabValue] = useState(0);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [patches, setPatches] = useState<Patch[]>([]);
    const [repositories, setRepositories] = useState<RepositoryFiles[]>([]);
    const [focusedFile, setFocusedFile] = useState<FileFocusTarget | null>(null);
    const [focusedPatch, setFocusedPatch] = useState<PatchFocusTarget | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, []);

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
                    </Toolbar>
                </AppBar>

                <Container maxWidth='xl' sx={{ mt: 4, mb: 4, flex: 1 }}>
                    {loading ?
                        <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
                            <CircularProgress />
                        </Box>
                    :   <Paper elevation={2}>
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
                    }
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
