import type { Doc, Query, Session } from '@nuvix/db'

export interface UserDocuments {
  find(collection: string, queries?: Query[]): Promise<Doc[]>
  findOne(collection: string, queries?: Query[]): Promise<Doc>
  count(collection: string, queries?: Query[], max?: number): Promise<number>
  get(collection: string, id: string, queries?: Query[]): Promise<Doc>
  create(collection: string, document: Doc): Promise<Doc>
  update(collection: string, id: string, document: Doc): Promise<Doc>
  remove(collection: string, id: string): Promise<boolean>
  transaction<Result>(operation: (documents: UserDocuments) => Promise<Result>): Promise<Result>
}

export function userDocuments(session: Session): UserDocuments {
  return Object.freeze({
    find: (collection: string, queries?: Query[]) => session.find(collection, queries),
    findOne: (collection: string, queries?: Query[]) => session.findOne(collection, queries),
    count: (collection: string, queries?: Query[], max?: number) =>
      session.count(collection, queries, max),
    get: (collection: string, id: string, queries?: Query[]) =>
      session.getDocument(collection, id, queries),
    create: (collection: string, document: Doc) => session.createDocument(collection, document),
    update: (collection: string, id: string, document: Doc) =>
      session.updateDocument(collection, id, document),
    remove: (collection: string, id: string) => session.deleteDocument(collection, id),
    transaction: <Result>(operation: (documents: UserDocuments) => Promise<Result>) =>
      session.withTransaction((transaction) => operation(userDocuments(transaction))),
  })
}
