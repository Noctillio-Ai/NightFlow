import { useState, useEffect, useCallback } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { currentProject } from "../state/projects.js";
import { sshConnected, gpuAvailable } from "../state/dashboard.js";

// Polls system metrics (CPU, memory, disk, GPUs) for the current project every 3s
export function useSystemMetrics() {
    const [metrics, setMetrics] = useState(null);
    const [error, setError] = useState(null);
    const connected = sshConnected.value;
    const project = currentProject.value;
    const projectId = project?.id;
    const sshCommand = project?.sshCommand;

    const retry = useCallback(() => {
        setError(null);
        setMetrics(null);
    }, []);

    useEffect(() => {
        if (!connected || !projectId) {
            setMetrics(null);
            setError(null);
            gpuAvailable.value = false;
            return;
        }

        let mounted = true;
        let timer;

        async function fetchMetrics() {
            try {
                const cmd = sshCommand?.trim().toLowerCase() === "localhost" ? null : sshCommand;
                const resStr = await invoke("get_system_metrics", { sshCommand: cmd, projectPath: project?.projectPath || null });
                if (mounted) {
                    const parsed = JSON.parse(resStr);
                    setMetrics(parsed);
                    setError(null);
                    gpuAvailable.value = !!(parsed.gpus && parsed.gpus.length > 0);
                }
            } catch (err) {
                if (mounted) setError(String(err));
            }

            if (mounted) {
                timer = setTimeout(fetchMetrics, 3000);
            }
        }

        fetchMetrics();

        return () => {
            mounted = false;
            clearTimeout(timer);
        };
    }, [connected, projectId, sshCommand]);

    return { metrics, error, connected, retry };
}
