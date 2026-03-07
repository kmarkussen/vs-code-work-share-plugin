import axios from "axios";
import { Activity, Patch } from "./types";

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
