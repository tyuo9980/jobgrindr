export type StatusKind = 'stage' | 'outcome';

export interface Status {
  id: number;
  name: string;
  /** #rrggbb */
  color: string;
  /** A stage is a step still in progress; an outcome ends the application. */
  kind: StatusKind;
  position: number;
  /** How many applications have this status anywhere in their history. */
  inUse: number;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | '';

export interface StatusChange {
  statusId: number;
  /** ISO date, yyyy-mm-dd */
  date: string;
}

export interface Application {
  id: number;
  company: string;
  role: string;
  url: string;
  location: string;
  workMode: WorkMode;
  salary: string;
  source: string;
  contact: string;
  notes: string;
  /** ISO date, yyyy-mm-dd */
  dateApplied: string;
  /** Every status the application has been in, oldest first. Never empty. */
  history: StatusChange[];
}

/** The fields a client sends to create or update an application. */
export type ApplicationInput = Omit<Application, 'id' | 'history'> & { statusId?: number };

export const currentStatusId = (app: Application): number =>
  app.history[app.history.length - 1].statusId;

export const lastUpdated = (app: Application): string =>
  app.history[app.history.length - 1].date;
