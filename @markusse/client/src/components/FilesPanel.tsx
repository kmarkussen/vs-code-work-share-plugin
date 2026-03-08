import {
    Box,
    Card,
    CardContent,
    Typography,
    Chip,
    Stack,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    List,
    ListItem,
    ListItemText,
    Divider,
    Alert,
} from "@mui/material";
import {
    ExpandMore as ExpandMoreIcon,
    Folder as FolderIcon,
    Edit as EditIcon,
    Person as PersonIcon,
} from "@mui/icons-material";
import { useEffect, useRef } from "react";
import { RepositoryFiles, FileEditInfo, FileFocusTarget } from "../types";

interface Props {
    repositories: RepositoryFiles[];
    focusedFile?: FileFocusTarget | null;
}

export default function FilesPanel({ repositories, focusedFile }: Props) {
    const focusedFileKey = focusedFile ? `${focusedFile.repositoryRemoteUrl}:${focusedFile.filePath}` : null;

    return (
        <Box>
            {focusedFile && (
                <Alert severity='info' sx={{ mb: 3 }}>
                    Showing selected activity for {focusedFile.filePath}
                </Alert>
            )}
            {repositories.length === 0 ?
                <Typography variant='body1' color='text.secondary' align='center' sx={{ py: 4 }}>
                    No file activity available
                </Typography>
            :   <Stack spacing={3}>
                    {repositories.map((repo) => (
                        <Card key={repo.repositoryRemoteUrl} elevation={2}>
                            <CardContent>
                                <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                                    <FolderIcon color='primary' sx={{ mr: 1 }} />
                                    <Typography variant='h6' component='div'>
                                        {repo.repositoryName}
                                    </Typography>
                                    <Chip label={`${repo.fileCount} files`} size='small' sx={{ ml: 2 }} />
                                </Box>

                                <Stack spacing={1}>
                                    {repo.files.map((file) => (
                                        <FileCard
                                            key={`${repo.repositoryRemoteUrl}:${file.repositoryFilePath}`}
                                            file={file}
                                            isFocused={
                                                focusedFileKey ===
                                                `${repo.repositoryRemoteUrl}:${file.repositoryFilePath}`
                                            }
                                        />
                                    ))}
                                </Stack>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            }
        </Box>
    );
}

function FileCard({ file, isFocused }: { file: FileEditInfo; isFocused: boolean }) {
    const cardRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (isFocused) {
            cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [isFocused]);

    return (
        <Card
            ref={cardRef}
            variant='outlined'
            sx={{
                backgroundColor: isFocused ? "rgba(33,150,243,0.12)" : "rgba(255,255,255,0.02)",
                borderColor: isFocused ? "primary.main" : undefined,
                boxShadow: isFocused ? 3 : 0,
                transition: "all 0.2s ease-in-out",
            }}>
            <CardContent>
                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Typography variant='subtitle1' sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                            {file.repositoryFileName}
                        </Typography>
                        <Chip
                            size='small'
                            color={file.patchCount > 0 ? "secondary" : "default"}
                            variant={file.patchCount > 0 ? "filled" : "outlined"}
                            label={`${file.patchCount} ${file.patchCount === 1 ? "patch" : "patches"}`}
                        />
                    </Box>
                    <Typography variant='caption' color='text.secondary' sx={{ fontFamily: "monospace" }}>
                        {file.repositoryFilePath}
                    </Typography>
                </Box>

                {/* Active Users Section */}
                <Box sx={{ mb: 2 }}>
                    <Typography variant='body2' sx={{ mb: 1, fontWeight: 500 }}>
                        <PersonIcon sx={{ fontSize: "0.9em", verticalAlign: "text-bottom", mr: 0.5 }} />
                        Currently Editing ({file.activeUsers.length})
                    </Typography>
                    <Stack direction='row' spacing={1} sx={{ flexWrap: "wrap" }}>
                        {file.activeUsers.map((user) => (
                            <Chip key={user} label={user} size='small' color='primary' />
                        ))}
                    </Stack>
                </Box>

                {/* Patches Section */}
                {file.patches.length > 0 && (
                    <>
                        <Divider sx={{ my: 2 }} />
                        <Accordion disableGutters defaultExpanded={file.patches.length <= 3}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <EditIcon sx={{ mr: 1, fontSize: "1.2em" }} />
                                <Typography variant='body2'>Pending Patches ({file.patches.length})</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <List dense>
                                    {file.patches.map((patch, idx) => (
                                        <Box key={idx}>
                                            <ListItem disableGutters>
                                                <ListItemText
                                                    primary={patch.userName}
                                                    secondary={`${new Date(patch.timestamp).toLocaleString()} • Commit: ${patch.baseCommit.slice(0, 8)}`}
                                                    primaryTypographyProps={{ variant: "body2" }}
                                                    secondaryTypographyProps={{ variant: "caption" }}
                                                />
                                            </ListItem>
                                            {idx < file.patches.length - 1 && <Divider sx={{ my: 0.5 }} />}
                                        </Box>
                                    ))}
                                </List>
                            </AccordionDetails>
                        </Accordion>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
