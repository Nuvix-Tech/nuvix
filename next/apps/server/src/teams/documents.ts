import type { Doc, Query, Session } from '@nuvix/db'

export interface TeamDocuments {
  find(collection: string, queries?: Query[]): Promise<Doc[]>
  count(collection: string, queries?: Query[], max?: number): Promise<number>
  get(collection: string, id: string, queries?: Query[]): Promise<Doc>
  create(collection: string, document: Doc): Promise<Doc>
  update(collection: string, id: string, document: Doc): Promise<Doc>
  remove(collection: string, id: string): Promise<boolean>
  removeMany(collection: string, queries?: Query[]): Promise<string[]>
  decreaseDocumentAttribute(
    collection: string,
    id: string,
    attribute: string,
    value: number,
    min: number,
  ): Promise<Doc>
  transaction<Result>(operation: (documents: TeamDocuments) => Promise<Result>): Promise<Result>
}

/** Runtime-narrows a caller Session, including transaction callbacks. */
export function teamDocuments(session: Session): TeamDocuments {
  return Object.freeze({
    find: (collection: string, queries?: Query[]) => session.find(collection, queries),
    count: (collection: string, queries?: Query[], max?: number) =>
      session.count(collection, queries, max),
    get: (collection: string, id: string, queries?: Query[]) =>
      session.getDocument(collection, id, queries),
    create: (collection: string, document: Doc) => session.createDocument(collection, document),
    update: (collection: string, id: string, document: Doc) =>
      session.updateDocument(collection, id, document),
    remove: (collection: string, id: string) => session.deleteDocument(collection, id),
    removeMany: (collection: string, queries?: Query[]) =>
      session.deleteDocuments(collection, queries),
    decreaseDocumentAttribute: (
      collection: string,
      id: string,
      attribute: string,
      value: number,
      min: number,
    ) => session.decreaseDocumentAttribute(collection, id, attribute, value, min),
    transaction: <Result>(operation: (documents: TeamDocuments) => Promise<Result>) =>
      session.withTransaction((transaction) => operation(teamDocuments(transaction))),
  })
}
