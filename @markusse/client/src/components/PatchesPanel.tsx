import { useEffect, useRef, useState } from "react";
import { Alert, Box, Card, CardContent, Typography, Chip, IconButton, Collapse, Paper, Divider } from "@mui/material";
import {
    ExpandMore as ExpandMoreIcon,
    Person as PersonIcon,
    Folder as FolderIcon,
    Code as CodeIcon,
    CalendarToday as CalendarIcon,
} from "@mui/icons-material";
import { Patch, PatchFocusTarget } from "../types";

interface Props {
    patches: Patch[];
    focusedPatch?: PatchFocusTarget | null;
}

export default function PatchesPanel({ patches, focusedPatch }: Props) {
    const sortedPatches = [...patches].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return (
        <Box>
            {focusedPatch && (
                <Alert severity='info' sx={{ mb: 3 }}>
                    Showing selected patch for {focusedPatch.filePath}
                </Alert>
            )}
            {sortedPatches.length === 0 ?
                <Typography variant='body1' color='text.secondary' align='center' sx={{ py: 4 }}>
                    No patches available
                </Typography>
            :   <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {sortedPatches.map((patch, index) => (
                        <PatchCard
                            key={`${patch.baseCommit}-${patch.userName}-${index}`}
                            patch={patch}
                            isFocused={
                                focusedPatch?.repositoryRemoteUrl === patch.repositoryRemoteUrl &&
                                focusedPatch?.filePath === patch.repositoryFilePath &&
                                focusedPatch?.timestamp === patch.timestamp &&
                                focusedPatch?.userName === patch.userName
                            }
                        />
                    ))}
                </Box>
            }
        </Box>
    );
}

function PatchCard({ patch, isFocused }: { patch: Patch; isFocused: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const cardRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (isFocused) {
            setExpanded(true);
            cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [isFocused]);

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    return (
        <Card
            ref={cardRef}
            elevation={isFocused ? 4 : 2}
            sx={{
                borderColor: isFocused ? "secondary.main" : undefined,
                borderWidth: isFocused ? 1 : 0,
                borderStyle: isFocused ? "solid" : undefined,
                backgroundColor: isFocused ? "rgba(245, 0, 87, 0.08)" : undefined,
                transition: "all 0.2s ease-in-out",
            }}>
            <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "start", mb: 2 }}>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant='h6' component='div' gutterBottom>
                            {patch.repositoryFilePath}
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                            <Chip icon={<PersonIcon />} label={patch.userName} size='small' variant='outlined' />
                            <Chip
                                icon={<FolderIcon />}
                                label={extractRepoName(patch.repositoryRemoteUrl)}
                                size='small'
                                variant='outlined'
                                color='primary'
                            />
                            <Chip
                                icon={<CalendarIcon />}
                                label={formatTimestamp(patch.timestamp)}
                                size='small'
                                variant='outlined'
                                color='secondary'
                            />
                        </Box>
                    </Box>
                    <IconButton
                        onClick={handleExpandClick}
                        aria-expanded={expanded}
                        aria-label='show more'
                        sx={{
                            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.3s",
                        }}>
                        <ExpandMoreIcon />
                    </IconButton>
                </Box>

                <Typography variant='body2' color='text.secondary' gutterBottom>
                    Base Commit: <code style={{ fontSize: "0.85em" }}>{patch.baseCommit.substring(0, 8)}</code>
                </Typography>

                <Collapse in={expanded} timeout='auto' unmountOnExit>
                    <Divider sx={{ my: 2 }} />
                    <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                        <CodeIcon sx={{ mr: 1 }} fontSize='small' />
                        <Typography variant='subtitle2'>Patch Diff</Typography>
                    </Box>
                    <Paper
                        variant='outlined'
                        sx={{
                            p: 2,
                            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "#0d0d0d" : "#f5f5f5"),
                            maxHeight: 400,
                            overflow: "auto",
                        }}>
                        <pre
                            style={{
                                margin: 0,
                                fontFamily: "monospace",
                                fontSize: "0.85em",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                            }}>
                            {patch.patch}
                        </pre>
                    </Paper>
                </Collapse>
            </CardContent>
        </Card>
    );
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
