import type { Instance, SavedRoster, Solution } from "./types";
import type { CurrencySettings } from "./currency";

export type LocalBusiness = {
  schema_version: 1;
  business_id: string;
  business_name: string;
  settings: CurrencySettings;
  draft: Instance;
  working?: SavedRoster | null;
  published: SavedRoster | null;
  published_at?: string;
};

declare global {
  interface Window {
    mital?: {
      solver<T>(op: string, payload: object, options?: { duals?: boolean }): Promise<T>;
      listBusinesses(): Promise<string[]>;
      loadBusiness(id: string): Promise<LocalBusiness>;
      saveBusiness(doc: LocalBusiness): Promise<LocalBusiness>;
      saveDraft(id: string, businessName: string, draft: Instance, settings: CurrencySettings): Promise<LocalBusiness>;
      saveWorking(id: string, instance: Instance, solution: Solution): Promise<boolean>;
      recoverBusiness(id: string): Promise<LocalBusiness>;
      backupStatus(id: string): Promise<"available" | "missing" | "damaged">;
      deleteBusiness(id: string): Promise<void>;
      listSaved(): Promise<string[]>;
      getSaved(id: string): Promise<SavedRoster>;
      putSaved(id: string, body: SavedRoster): Promise<SavedRoster>;
      exportBackup(id: string): Promise<string | null>;
      exportCsv(name: string, csv: string): Promise<string | null>;
      importBackup(): Promise<string | null>;
      openDataFolder(): Promise<void>;
      printRoster(payload: { instance: Instance; solution: Solution; settings: CurrencySettings; business_name?: string }): Promise<void>;
      getPrintPayload(): Promise<{ instance: Instance; solution: Solution; settings: CurrencySettings; business_name?: string }>;
    };
  }
}

export {};
