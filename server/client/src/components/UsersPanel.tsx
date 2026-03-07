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
} from "@mui/material";
import { Person as PersonIcon, AccessTime as TimeIcon, Folder as FolderIcon } from "@mui/icons-material";
import { Activity, Patch, UserData } from "../types";

interface Props {
    activities: Activity[];
    patches: Patch[];
}

export default function UsersPanel({ activities, patches }: Props) {
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
    });

    return Array.from(userMap.values()).sort((a, b) => {
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
}

function extractRepoName(url: string): string {
    const normalized = url.replace(/\.git$/, "");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] || url;
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
