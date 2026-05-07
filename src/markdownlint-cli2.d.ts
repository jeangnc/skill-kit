declare module "markdownlint-cli2" {
  interface MainParams {
    readonly directory?: string;
    readonly argv?: readonly string[];
    readonly optionsDefault?: { readonly config?: Readonly<Record<string, unknown>> };
    readonly optionsOverride?: { readonly config?: Readonly<Record<string, unknown>> };
    readonly logMessage?: (line: string) => void;
    readonly logError?: (line: string) => void;
    readonly noImport?: boolean;
    readonly allowStdin?: boolean;
  }
  export function main(params: MainParams): Promise<number>;
}
