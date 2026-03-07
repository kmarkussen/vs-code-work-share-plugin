import { Box, Card, CardContent, Typography, Grid, Chip, List, ListItem, ListItemText, Divider } from "@mui/material";
import { Folder as FolderIcon, Person as PersonIcon, Edit as EditIcon } from "@mui/icons-material";
import { Activity, Patch, Repository } from "../types";

interface Props {
    activities: Activity[];
    patches: Patch[];
}

export default function RepositoriesPanel({ activities, patches }: Props) {
    const repositories = aggregateRepositories(activities, patches);

    return (
        <Box>
            {repositories.length === 0 ?
                <Typography variant='body1' color='text.secondary' align='center' sx={{ py: 4 }}>
                    No repository data available
                </Typography>
            :   <Grid container spacing={3}>
                    {repositories.map((repo) => (
                        <Grid item xs={12} md={6} lg={4} key={repo.url}>
                            <Card elevation={3} sx={{ height: "100%" }}>
                                <CardContent>
                                    <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                                        <FolderIcon color='primary' sx={{ mr: 1 }} />
                                        <Typography variant='h6' component='div' noWrap>
                                            {repo.name}
                                        </Typography>
                                    </Box>

                                    <Box sx={{ mb: 2 }}>
                                        <Chip
                                            label={`${repo.activityCount} activities`}
                                            size='small'
                                            color='primary'
                                            variant='outlined'
                                            sx={{ mr: 1 }}
                                        />
                                        <Chip
                                            label={`${repo.patchCount} patches`}
                                            size='small'
                                            color='secondary'
                                            variant='outlined'
                                        />
                                    </Box>

                                    <Divider sx={{ my: 2 }} />

                                    <Typography variant='subtitle2' gutterBottom>
                                        <PersonIcon fontSize='small' sx={{ verticalAlign: "middle", mr: 0.5 }} />
                                        Active Users ({repo.users.length})
                                    </Typography>
                                    <List dense disablePadding>
                                        {repo.users.slice(0, 5).map((user) => (
                                            <ListItem key={user} disableGutters disablePadding>
                                                <ListItemText
                                                    primary={user}
                                                    primaryTypographyProps={{ variant: "body2" }}
                                                />
                                            </ListItem>
                                        ))}
                                        {repo.users.length > 5 && (
                                            <ListItem disableGutters disablePadding>
                                                <ListItemText
                                                    primary={`+${repo.users.length - 5} more`}
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

function aggregateRepositories(activities: Activity[], patches: Patch[]): Repository[] {
    const repoMap = new Map<string, Repository>();

    activities.forEach((activity) => {
        const url = activity.repositoryRemoteUrl;
        if (!repoMap.has(url)) {
            repoMap.set(url, {
                url,
                name: extractRepoName(url),
                activityCount: 0,
                patchCount: 0,
                users: [],
            });
        }
        const repo = repoMap.get(url)!;
        repo.activityCount++;
        if (!repo.users.includes(activity.userName)) {
            repo.users.push(activity.userName);
        }
    });

    patches.forEach((patch) => {
        const url = patch.repositoryRemoteUrl;
        if (!repoMap.has(url)) {
            repoMap.set(url, {
                url,
                name: extractRepoName(url),
                activityCount: 0,
                patchCount: 0,
                users: [],
            });
        }
        const repo = repoMap.get(url)!;
        repo.patchCount++;
        if (!repo.users.includes(patch.userName)) {
            repo.users.push(patch.userName);
        }
    });

    return Array.from(repoMap.values()).sort(
        (a, b) => b.activityCount + b.patchCount - (a.activityCount + a.patchCount),
    );
}

function extractRepoName(url: string): string {
    const normalized = url.replace(/\.git$/, "");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] || url;
}
