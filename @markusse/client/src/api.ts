import axios from "axios";
import { Activity, Patch, RepositoryFiles } from "./types";

const api = axios.create({
    baseURL: "/",
    timeout: 5000,
});

export async function fetchActivities(): Promise<Activity[]> {
    const response = await api.get("/activities", {
        params: { _: Date.now() },
    });
    return response.data.activities || [];
}

export async function fetchPatches(): Promise<Patch[]> {
    const response = await api.get("/patches", {
        params: { _: Date.now() },
    });
    return response.data.patches || [];
}

export async function fetchFiles(): Promise<RepositoryFiles[]> {
    const response = await api.get("/files", {
        params: { _: Date.now() },
    });
    return response.data.repositories || [];
}
