/**
 * Logger abstraction - works in both CLI and GitHub Actions contexts
 */
export interface Logger {
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}
/**
 * GitHub Actions logger - wraps @actions/core
 */
export declare class ActionsLogger implements Logger {
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}
/**
 * Console logger for CLI usage
 */
export declare class ConsoleLogger implements Logger {
    private verbose;
    constructor(verbose?: boolean);
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}
/**
 * Quiet logger - only outputs errors
 */
export declare class QuietLogger implements Logger {
    info(_message: string): void;
    warning(_message: string): void;
    error(message: string): void;
    debug(_message: string): void;
}
export declare function setLogger(logger: Logger): void;
export declare function getLogger(): Logger;
export declare const log: {
    info: (message: string) => void;
    warning: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
};
