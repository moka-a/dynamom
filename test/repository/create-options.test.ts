import { createOptions } from "../../lib/repository/create-options"
import { User } from "../stubs/user"
import { Post } from "../stubs/post"


describe("testsuite of repository/create-options", () => {
  it("test createOptions of User", () => {
    expect(createOptions(User)).toEqual({
      tableName: "users",
      ctor: User,
      generatedValues: [
        {
          property: "id",
          sourceKey: "user_id",
          strategy: "uuid",
        }
      ],
      hashKey: {
        property: "id",
        sourceKey: "user_id",
      },
      rangeKey: {
        property: "username",
        sourceKey: "username",
      },
      indexes: [
        {
          name: "index__created_at__user_id",
          hashKey: {
            property: "createdAt",
            sourceKey: "created_at",
            generated: undefined,
          },
          rangeKey: {
            property: "id",
            sourceKey: "user_id",
            generated: undefined,
          },
        },
        {
          name: "index__email",
          hashKey: {
            property: "email",
            sourceKey: "email",
            generated: undefined,
          },
          rangeKey: undefined,
        },
      ],
      columns: [
        {
          property: "id",
          sourceKey: "user_id",
          type: "string",
        },
        {
          property: "username",
          sourceKey: "username",
          type: "string",
        },
        {
          property: "email",
          sourceKey: "email",
          type: "string",
        },
        {
          property: "type",
          sourceKey: "type_tt",
          type: "string",
        },
        {
          property: "createdAt",
          sourceKey: "created_at",
          type: "string",
        },
      ],
      relations: [],
    })
  })

  it("test createOptions of posts", () => {
    expect(createOptions(Post)).toEqual({
      tableName: "posts",
      ctor: Post,
      generatedValues: [
        {
          property: "id",
          sourceKey: "id",
          strategy: "kuuid",
        }
      ],
      hashKey: {
        property: "pk",
        sourceKey: "pk",
      },
      rangeKey: {
        property: "id",
        sourceKey: "id",
      },
      indexes: [
        {
          name: "index__user_id__id",
          hashKey: {
            property: "userId",
            sourceKey: "user_id",
            generated: undefined
          },
          rangeKey: {
            property: "id",
            sourceKey: "id",
            generated: undefined,
          }
        },
      ],
      columns: [
        {
          property: "pk",
          sourceKey: "pk",
          type: "string",
        },
        {
          property: "id",
          sourceKey: "id",
          type: "string",
        },
        {
          property: "userId",
          sourceKey: "user_id",
          type: "string",
        },
        {
          property: "content",
          sourceKey: "content",
          type: "string",
        },
        {
          property: "createdAt",
          sourceKey: "created_at",
          type: "string",
        },
      ],
      relations: [],
    })
  })
})
