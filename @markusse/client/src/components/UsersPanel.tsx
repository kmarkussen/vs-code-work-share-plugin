import {
    Box,
    Card,
    CardContent,
    Typography,
    Grid,
    Chip,
    List,
    ListItem,
    ListItemText,
    Divider,
    Avatar,
    Stack,
    ListItemButton,
} from "@mui/material";
import {
    Person as PersonIcon,
    AccessTime as TimeIcon,
    Folder as FolderIcon,
    Edit as EditIcon,
    MergeType as PatchIcon,
} from "@mui/icons-material";
import { Activity, Patch, UserData, UserRecentActivity } from "../types";

interface Props {
    activities: Activity[];
    patches: Patch[];
    onRecentActivityClick?: (activity: UserRecentActivity) => void;
}

export default function UsersPanel({ activities, patches, onRecentActivityClick }: Props) {
    const users = aggregateUsers(activities, patches);

    return (
        <Box>
            {users.length === 0 ?
                <Typography variant='body1' color='text.secondary' align='center' sx={{ py: 4 }}>
                    No user data available
                </Typography>
            :   <Grid container spacing={3}>
                    {users.map((user) => (
                        <Grid item xs={12} md={6} lg={4} key={user.name}>
                            <Card elevation={3} sx={{ height: "100%" }}>
                                <CardContent>
                                    <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                                        <Avatar sx={{ bgcolor: "primary.main", mr: 2 }}>
                                            <PersonIcon />
                                        </Avatar>
                                        <Box>
                                            <Typography variant='h6' component='div'>
                                                {user.name}
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                color='text.secondary'
                                                sx={{ display: "flex", alignItems: "center" }}>
                                                <TimeIcon fontSize='small' sx={{ mr: 0.5 }} />
                                                {formatTimestamp(user.lastActivity)}
                                            </Typography>
                                        </Box>
                                    </Box>

                                    <Box sx={{ mb: 2 }}>
                                        <Chip
                                            label={`${user.activityCount} activities`}
                                            size='small'
                                            color='primary'
                                            variant='outlined'
                                            sx={{ mr: 1 }}
                                        />
                                        <Chip
                                            label={`${user.patchCount} patches`}
                                            size='small'
                                            color='secondary'
                                            variant='outlined'
                                        />
                                    </Box>

                                    <Divider sx={{ my: 2 }} />

                                    <Typography variant='subtitle2' gutterBottom>
                                        <FolderIcon fontSize='small' sx={{ verticalAlign: "middle", mr: 0.5 }} />
                                        Repositories ({user.repositories.length})
                                    </Typography>
                                    <List dense disablePadding>
                                        {user.repositories.slice(0, 3).map((repo) => (
                                            <ListItem key={repo} disableGutters disablePadding>
                                                <ListItemText
                                                    primary={repo}
                                                    primaryTypographyProps={{ variant: "body2" }}
                                                />
                                            </ListItem>
                                        ))}
                                        {user.repositories.length > 3 && (
                                            <ListItem disableGutters disablePadding>
                                                <ListItemText
                                                    primary={`+${user.repositories.length - 3} more`}
                                                    primaryTypographyProps={{
                                                        variant: "body2",
                                                        color: "text.secondary",
                                                    }}
                                                />
                                            </ListItem>
                                        )}
                                    </List>

                                    <Divider sx={{ my: 2 }} />

                                    <Typography variant='subtitle2' gutterBottom>
                                        <TimeIcon fontSize='small' sx={{ verticalAlign: "middle", mr: 0.5 }} />
                                        Recent activity
                                    </Typography>
                                    <List dense disablePadding>
                                        {user.recentActivities.slice(0, 5).map((item, index) => (
                                            <Box key={`${item.type}-${item.timestamp}-${item.filePath}-${index}`}>
                                                <ListItem disableGutters sx={{ alignItems: "flex-start", px: 0 }}>
                                                    <ListItemButton
                                                        onClick={() => onRecentActivityClick?.(item)}
                                                        sx={{
                                                            alignItems: "flex-start",
                                                            borderRadius: 1,
                                                            px: 1,
                                                            py: 0.75,
                                                        }}>
                                                        <ListItemText
                                                            primary={
                                                                <Stack
                                                                    direction='row'
                                                                    spacing={1}
                                                                    alignItems='center'
                                                                    flexWrap='wrap'
                                                                    useFlexGap>
                                                                    {item.type === "patch" ?
                                                                        <PatchIcon fontSize='small' color='secondary' />
                                                                    :   <EditIcon fontSize='small' color='primary' />}
                                                                    <Typography variant='body2' component='span'>
                                                                        {item.summary}
                                                                    </Typography>
                                                                </Stack>
                                                            }
                                                            secondary={
                                                                <>
                                                                    <Typography
                                                                        component='span'
                                                                        variant='caption'
                                                                        color='text.secondary'
                                                                        display='block'>
                                                                        {item.repositoryName} · {item.filePath}
                                                                    </Typography>
                                                                    <Typography
                                                                        component='span'
                                                                        variant='caption'
                                                                        color='text.secondary'>
                                                                        {formatTimestamp(item.timestamp)} · View in
                                                                        {item.type === "patch" ? " Patches" : " Files"}
                                                                    </Typography>
                                                                </>
                                                            }
                                                        />
                                                    </ListItemButton>
                                                </ListItem>
                                                {index < Math.min(user.recentActivities.length, 5) - 1 && (
                                                    <Divider component='li' sx={{ opacity: 0.4 }} />
                                                )}
                                            </Box>
                                        ))}
                                    </List>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            }
        </Box>
    );
}

function aggregateUsers(activities: Activity[], patches: Patch[]): UserData[] {
    const userMap = new Map<string, UserData>();

    activities.forEach((activity) => {
        const name = activity.userName;
        if (!userMap.has(name)) {
            userMap.set(name, {
                name,
                repositories: [],
                activityCount: 0,
                patchCount: 0,
                lastActivity: activity.timestamp,
                recentActivities: [],
            });
        }
        const user = userMap.get(name)!;
        user.activityCount++;
        const repoName = extractRepoName(activity.repositoryRemoteUrl);
        if (!user.repositories.includes(repoName)) {
            user.repositories.push(repoName);
        }
        if (activity.timestamp > user.lastActivity) {
            user.lastActivity = activity.timestamp;
        }
        user.recentActivities.push({
            type: "activity",
            timestamp: activity.timestamp,
            userName: activity.userName,
            repositoryRemoteUrl: activity.repositoryRemoteUrl,
            repositoryName: repoName,
            filePath: activity.filePath,
            summary: `${formatAction(activity.action)} ${extractFileName(activity.filePath)}`,
        });
    });

    patches.forEach((patch) => {
        const name = patch.userName;
        if (!userMap.has(name)) {
            userMap.set(name, {
                name,
                repositories: [],
                activityCount: 0,
                patchCount: 0,
                lastActivity: patch.timestamp,
                recentActivities: [],
            });
        }
        const user = userMap.get(name)!;
        user.patchCount++;
        const repoName = extractRepoName(patch.repositoryRemoteUrl);
        if (!user.repositories.includes(repoName)) {
            user.repositories.push(repoName);
        }
        if (patch.timestamp > user.lastActivity) {
            user.lastActivity = patch.timestamp;
        }
        user.recentActivities.push({
            type: "patch",
            timestamp: patch.timestamp,
            userName: patch.userName,
            repositoryRemoteUrl: patch.repositoryRemoteUrl,
            repositoryName: repoName,
            filePath: patch.repositoryFilePath,
            summary: `Shared patch for ${extractFileName(patch.repositoryFilePath)}`,
        });
    });

    return Array.from(userMap.values())
        .map((user) => ({
            ...user,
            recentActivities: sortRecentActivities(user.recentActivities).slice(0, 5),
        }))
        .sort((a, b) => {
            return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
        });
}

function extractRepoName(url: string): string {
    const normalized = url.replace(/\.git$/, "");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] || url;
}

function extractFileName(filePath: string): string {
    const segments = filePath.split("/").filter((segment) => segment.length > 0);
    return segments[segments.length - 1] || filePath;
}

function formatAction(action: Activity["action"]): string {
    switch (action) {
        case "open":
            return "Opened";
        case "edit":
            return "Edited";
        case "close":
            return "Closed";
        default:
            return action;
    }
}

function sortRecentActivities(activities: UserRecentActivity[]): UserRecentActivity[] {
    return [...activities].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}
