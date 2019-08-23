import { DynamoDB } from "aws-sdk"
import { WriteRequest } from "aws-sdk/clients/dynamodb"
import { ConstructType } from "relater"
import { DynamoCursor, DynamoNode, QueryOptions, QueryResult } from "../interfaces/connection"
import { createOptions } from "../repository/create-options"
import { Repository } from "../repository/repository"
import { fromDynamoAttributeMap } from "./from-dynamo-attribute"
import { toDynamoAttributeMap, toDynamoAttribute } from "./to-dynamo-attribute"
import { RepositoryOptions } from "../interfaces/repository"


export class Connection {

  public repositories = new Map<ConstructType<any>, Repository<any>>()

  public constructor(public client: DynamoDB) { }

  public getRepository<Entity, R extends Repository<Entity>>(ctor: ConstructType<Entity>): R {
    let repository = this.repositories.get(ctor)
    if (!repository) {
      repository = new Repository(this, createOptions(ctor))
      this.repositories.set(ctor, repository)
    }
    return repository as R
  }

  public putItems<P = any>(options: RepositoryOptions<P>, rows: DynamoNode<P>[] = []): Promise<boolean[]> {
    if (rows.length === 0) {
      return Promise.resolve([])
    }
    return new Promise((resolve, reject) => {
      let writeRequests: WriteRequest[]
      try {
        writeRequests = rows.map(({ cursor: { hashKey, rangeKey }, node }): WriteRequest => {
          return options.rangeKey 
            ? {
              PutRequest: {
                Item: {
                  [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
                  [options.rangeKey.sourceKey]: toDynamoAttribute(rangeKey),
                  ...toDynamoAttributeMap(node),
                },
              }
            }
            : {
              PutRequest: {
                Item: {
                  [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
                  ...toDynamoAttributeMap(node),
                },
              }
            }
        })
      } catch (e) {
        return reject(e)
      }

      this.client.batchWriteItem({
        RequestItems: {
          [`${options.tableName}`]: writeRequests,
        },
      }, (err, result) => {
        if (err) {
          return reject(err)
        }
        if (result.UnprocessedItems && result.UnprocessedItems[`${options.tableName}`]) {
          const failKeys = result.UnprocessedItems[`${options.tableName}`]
            .filter(({ DeleteRequest }) => DeleteRequest)
            .map(({ DeleteRequest }) => DeleteRequest!.Key)

          resolve(rows.map(({ cursor: { hashKey, rangeKey } }) => {
            const foundFailKey = failKeys.find((failKey) => failKey[options.hashKey.sourceKey].S === hashKey && (
              (!!options.rangeKey && (failKey[options.rangeKey.sourceKey].S === rangeKey)) ||
              (!!options.rangeKey && (failKey[options.rangeKey.sourceKey].N === rangeKey))
            ))
            return foundFailKey ? true : false
          }))
        }
        resolve(rows.map(() => true))
      }).promise()
    })
  }

  public putItem<P = any>(options: RepositoryOptions<P>, row: DynamoNode<P>): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.client.putItem({
        TableName: options.tableName,
        ReturnValues: "ALL_OLD",
        Item: options.rangeKey 
          ? {
            [options.hashKey.sourceKey]: toDynamoAttribute(row.cursor.hashKey),
            [options.rangeKey.sourceKey]: toDynamoAttribute(row.cursor.rangeKey),
            ...toDynamoAttributeMap(row.node),
          } 
          : {
            [options.hashKey.sourceKey]: toDynamoAttribute(row.cursor.hashKey),
            ...toDynamoAttributeMap(row.node),
          },
      }, (err) => {
        if (err) {
          return reject(err)
        }
        resolve(true)
      })
    })
  }

  public updateItem<P = any>(options: RepositoryOptions<P>, row: DynamoNode<P>): Promise<boolean> {
    const hashKey = options.hashKey.sourceKey
    const rangeKey = options.rangeKey ? options.rangeKey.sourceKey : undefined
    const keys = Object.keys(row.node).filter((key) => key != hashKey && key != rangeKey)
    
    return new Promise((resolve, reject) => {
      this.client.updateItem({
        TableName: options.tableName,
        Key: rangeKey
          ? {
            [`${hashKey}`]: toDynamoAttribute(row.cursor.hashKey),
            [`${rangeKey}`]: toDynamoAttribute(row.cursor.rangeKey)
          }
          : {
            [`${hashKey}`]: toDynamoAttribute(row.cursor.hashKey)
          },
        UpdateExpression: `SET ${keys.map(key => `#${key} = :${key}`).join(', ')}`,
        ExpressionAttributeNames: keys.reduce((carry, key) => {
          carry[`#${key}`] = key
          return carry
        }, {} as any),
        ExpressionAttributeValues: keys.reduce((carry, key) => {
          carry[`:${key}`] = toDynamoAttribute((row.node as any)[key])
          return carry
        }, {} as any),
      }, (err) => {
        if (err) {
          return reject(err)
        }
        resolve(true)
      })
    })
  }

  public getItem<P = any>(options: RepositoryOptions<P>, cursor: DynamoCursor): Promise<any | null> {
    return new Promise((resolve, reject) => this.client.getItem({
      TableName: `${options.tableName}`,
      Key: options.rangeKey 
        ? {
          [options.hashKey.sourceKey]: toDynamoAttribute(cursor.hashKey),
          [options.rangeKey.sourceKey]: toDynamoAttribute(cursor.rangeKey),
        } 
        : {
          [options.hashKey.sourceKey]: toDynamoAttribute(cursor.hashKey),
        },
    }, (err, data) => {
      if (err) {
        return reject(err)
      }
      if (data && data.Item) {
        resolve(fromDynamoAttributeMap(data.Item))
      }
      resolve(null)
    }))
  }

  public query<P = any>(options: RepositoryOptions<P>, { indexName, hash, range, limit = 20, after, desc = false }: QueryOptions<P> = { hash: "all" }): Promise<QueryResult<P>> {
    const hashKey = indexName 
      ? (() => {
        const indexHash = options.indexes.find(({ name }) => name == indexName)!.hashKey
        if (indexHash.generated) {
          return indexHash.generated.key!
        }
        else {
          return indexHash.sourceKey!
        }
      })()
      : options.hashKey.sourceKey
    const rangeKey = indexName 
      ? (() => {
        const indexRange = options.indexes.find(({ name }) => name == indexName)!.rangeKey
        if (!indexRange) {
          return undefined
        }

        if (indexRange.generated) {
          return indexRange.generated.key
        }
        else {
          return indexRange.sourceKey
        }
      })() 
      : options.rangeKey ? options.rangeKey.sourceKey : undefined

    return new Promise((resolve, reject) => this.client.query({
      TableName: `${options.tableName}`,
      IndexName: indexName ? indexName : undefined,
      Limit: limit,
      KeyConditionExpression: range 
        ? `#hashkey = :hashkey and begins_with(#rangekey, :rangekey)` 
        : `#hashkey = :hashkey`,
      ExpressionAttributeNames: range 
        ? {
          "#hashkey": hashKey,
          "#rangekey": rangeKey!
        } 
        : {
          "#hashkey": hashKey
        },
      ExpressionAttributeValues: range 
        ? {
          ":hashkey": typeof hash == "string" ? { S: hash } : { N: `${hash}` },
          ":rangekey": { S: `${range}__` }
        } 
        : {
          ":hashkey": typeof hash == "string" ? { S: hash } : { N: `${hash}` }
        },
      ExclusiveStartKey: after 
        ? (rangeKey 
          ? {
            [hashKey]: typeof after.hashKey == "string"
              ? { S: `${after.hashKey}` }
              : { N: `${after.hashKey}` },
            [rangeKey]: typeof after.rangeKey == "string"
              ? { S: `${after.rangeKey}` }
              : { N: `${after.rangeKey}` },
          } 
          : {
            [hashKey]: typeof after.hashKey == "string"
              ? { S: `${after.hashKey}` }
              : { N: `${after.hashKey}` },
          }) 
        : undefined,
      ScanIndexForward: !desc,
    }, (err, result) => {
      if (err) {
        return reject(err)
      }
      const nodes: DynamoNode<P>[] = (result.Items || []).map((item) => {
        const node = fromDynamoAttributeMap(item) as P
        return {
          cursor: rangeKey
            ? {
              hashKey: item[hashKey].S
                ? `${item[hashKey].S}`
                : +(item[hashKey].N as string),
              rangeKey: item[rangeKey].S
                ? `${item[rangeKey].S}`
                : +(item[rangeKey].N as string)
            }
            : {
              hashKey: item[hashKey].S
                ? `${item[hashKey].S}`
                : +(item[hashKey].N as string),
            },
          node,
        }
      })
      if (result.LastEvaluatedKey) {
        const lastCursor = fromDynamoAttributeMap(result.LastEvaluatedKey)
        return resolve({
          nodes,
          endCursor: {
            hashKey: lastCursor[hashKey],
            rangeKey: rangeKey ? lastCursor[rangeKey] : undefined
          },
        })
      }
      resolve({
        nodes,
      })
    }))
  }

  public count<P = any>(options: RepositoryOptions<P>, hashKey: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.client.query({
        TableName: `${options.tableName}`,
        Select: "COUNT",
        KeyConditionExpression: `#hashkey = :hashkey`,
        ExpressionAttributeNames: {
          "#hashkey": options.hashKey.sourceKey,
        },
        ExpressionAttributeValues: {
          ":hashkey": {S: hashKey},
        },
      }, (err, result) => {
        if (err) {
          return reject(err)
        }
        resolve(result.Count || 0)
      })
    })
  }

  public getManyItems<P = any>(options: RepositoryOptions<P>, cursors: DynamoCursor[]): Promise<any[]> {
    if (cursors.length === 0) {
      return Promise.resolve([])
    }
    return new Promise((resolve, reject) => this.client.batchGetItem({
      RequestItems: {
        [`${options.tableName}`]: {
          Keys: cursors.map((cursor) => (options.rangeKey 
            ? {
              [options.hashKey.sourceKey]: { S: cursor.hashKey as string },
              [options.rangeKey.sourceKey]: toDynamoAttribute(cursor.rangeKey),
            } 
            : {
              [options.hashKey.sourceKey]: { S: cursor.hashKey as string },
            })),
        },
      }
    }, (err, result) => {
      if (err) {
        return reject(err)
      }
      if (result && result.Responses && result.Responses[`${options.tableName}`]) {
        return resolve(result.Responses[`${options.tableName}`].map(fromDynamoAttributeMap))
      }
      resolve([])
    }))
  }

  public deleteItem<P = any>(options: RepositoryOptions<P>, hashKey: string, rangeKey?: string): Promise<boolean> {
    return new Promise((resolve, reject) => this.client.deleteItem({
      TableName: `${options.tableName}`,
      Key: options.rangeKey 
        ? {
          [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
          [options.rangeKey.sourceKey]: toDynamoAttribute(rangeKey),
        } 
        : {
          [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
        },
    }, (err) => {
      if (err) {
        return reject(err)
      }
      resolve(true)
    }))
  }

  public deleteManyItems<P = any>(options: RepositoryOptions<P>, cursors: DynamoCursor[]): Promise<boolean[]> {
    if (cursors.length === 0) {
      return Promise.resolve([])
    }
    return new Promise(((resolve, reject) => {
      this.client.batchWriteItem({
        RequestItems: {
          [`${options.tableName}`]: cursors.map(({ hashKey, rangeKey }): WriteRequest => {
            return {
              DeleteRequest: {
                Key: options.rangeKey 
                  ? {
                    [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
                    [options.rangeKey.sourceKey]: toDynamoAttribute(rangeKey),
                  }
                  : {
                    [options.hashKey.sourceKey]: toDynamoAttribute(hashKey),
                  },
              }
            }
          }),
        },
      }, (err, result) => {
        if (err) {
          return reject(err)
        }
        if (result.UnprocessedItems && result.UnprocessedItems[`${options.tableName}`]) {
          const failKeys = result.UnprocessedItems[`${options.tableName}`]
            .filter(({DeleteRequest}) => DeleteRequest)
            .map(({DeleteRequest}) => DeleteRequest!.Key)
          resolve(cursors.map((cursor) => {
            const foundFailKey = failKeys.find((failKey) => failKey[options.hashKey.sourceKey].S === cursor.hashKey && (
              (!!options.rangeKey && (failKey[options.rangeKey.sourceKey].S === cursor.rangeKey)) || 
              (!!options.rangeKey && (failKey[options.rangeKey.sourceKey].N === cursor.rangeKey))
            ))
            return foundFailKey ? true : false
          }))
        }
        resolve(cursors.map(() => true))
      }).promise()
    }))
  }

}
