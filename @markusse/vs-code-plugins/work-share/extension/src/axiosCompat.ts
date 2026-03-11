export interface AxiosResponse<T> {
    data: T;
    status: number;
}

export interface AxiosError extends Error {
    isAxiosError: boolean;
    response?: {
        status: number;
        data?: unknown;
    };
}

export interface AxiosInstance {
    get<T>(
        url: string,
        config?: {
            params?: Record<string, unknown>;
        },
    ): Promise<AxiosResponse<T>>;
    post<T>(url: string, data?: unknown): Promise<AxiosResponse<T>>;
    /** Mutable default headers merged into every request (e.g. for Bearer tokens). */
    headers: Record<string, string>;
}

interface CreateConfig {
    baseURL: string;
    timeout: number;
    headers?: Record<string, string>;
}

class FetchAxiosError extends Error implements AxiosError {
    public readonly isAxiosError = true;

    constructor(
        message: string,
        public response?: {
            status: number;
            data?: unknown;
        },
    ) {
        super(message);
        this.name = "AxiosError";
    }
}

function toQueryString(params?: Record<string, unknown>): string {
    if (!params) {
        return "";
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
            continue;
        }

        query.set(key, String(value));
    }

    const queryText = query.toString();
    return queryText ? `?${queryText}` : "";
}

async function parseResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        return response.json();
    }

    const text = await response.text();
    if (!text) {
        return undefined;
    }

    return text;
}

function create(config: CreateConfig): AxiosInstance {
    // Mutable copy so callers can inject/remove headers (e.g. Authorization) at runtime.
    const clientHeaders: Record<string, string> = { ...(config.headers ?? {}) };

    const request = async <T>(
        method: "GET" | "POST",
        url: string,
        body?: unknown,
        params?: Record<string, unknown>,
    ) => {
        const query = method === "GET" ? toQueryString(params) : "";
        const endpoint = `${config.baseURL.replace(/\/$/, "")}${url}${query}`;

        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), config.timeout);

        try {
            const response = await fetch(endpoint, {
                method,
                headers: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    "Content-Type": "application/json",
                    ...clientHeaders,
                },
                body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
                signal: controller.signal,
            });

            const data = await parseResponseBody(response);
            if (!response.ok) {
                const message =
                    typeof data === "object" && data && "message" in data ?
                        String((data as { message?: unknown }).message ?? `HTTP ${response.status}`)
                    :   `HTTP ${response.status}`;

                throw new FetchAxiosError(message, {
                    status: response.status,
                    data,
                });
            }

            return {
                data: data as T,
                status: response.status,
            };
        } catch (error) {
            if (error instanceof FetchAxiosError) {
                throw error;
            }

            if (error instanceof Error && error.name === "AbortError") {
                throw new FetchAxiosError(`Request timed out after ${config.timeout}ms`);
            }

            throw new FetchAxiosError(error instanceof Error ? error.message : String(error));
        } finally {
            clearTimeout(timeoutHandle);
        }
    };

    return {
        get: <T>(url: string, requestConfig?: { params?: Record<string, unknown> }) => {
            return request<T>("GET", url, undefined, requestConfig?.params);
        },
        post: <T>(url: string, body?: unknown) => {
            return request<T>("POST", url, body);
        },
        headers: clientHeaders,
    };
}

function isAxiosError(error: unknown): error is AxiosError {
    return (
        typeof error === "object" &&
        error !== null &&
        "isAxiosError" in error &&
        (error as { isAxiosError?: unknown }).isAxiosError === true
    );
}

export default {
    create,
    isAxiosError,
};
