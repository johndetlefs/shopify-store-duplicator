/**
 * GraphQL query and mutation strings for Shopify Admin API.
 * Version: 2025-10
 */

/**
 * Bulk Operations
 */
export const BULK_OPERATION_RUN_QUERY = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
        url
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CURRENT_BULK_OPERATION = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
`;

/**
 * Metaobject Definitions
 */
export const METAOBJECT_DEFINITIONS_QUERY = `
  query metaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      edges {
        node {
          id
          name
          type
          description
          displayNameKey
          fieldDefinitions {
            key
            name
            description
            required
            type {
              name
            }
            validations {
              name
              value
            }
          }
          capabilities {
            publishable {
              enabled
            }
            translatable {
              enabled
            }
            renderable {
              enabled
              data {
                metaobjectId
                metafieldKeys
              }
            }
            onlineStore {
              enabled
              data {
                aliasMapping {
                  key
                  value
                }
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE = `
  mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_UPDATE = `
  mutation metaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Metafield Definitions
 */
export const METAFIELD_DEFINITIONS_QUERY = `
  query metafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      edges {
        node {
          id
          name
          namespace
          key
          description
          type {
            name
          }
          ownerType
          validations {
            name
            value
          }
          pin {
            pinnedPosition
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAFIELD_DEFINITION_UPDATE = `
  mutation metafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Metaobjects (Data/Entries)
 */
export const METAOBJECTS_BY_TYPE_BULK = (type: string) => `
  {
    metaobjects(type: "${type}") {
      edges {
        node {
          id
          handle
          type
          displayName
          updatedAt
          fields {
            key
            type
            value
            reference {
              __typename
              ... on Metaobject {
                id
                type
                handle
              }
              ... on Product {
                id
                handle
              }
              ... on ProductVariant {
                id
                sku
                product {
                  handle
                }
              }
              ... on Collection {
                id
                handle
              }
              ... on Page {
                id
                handle
              }
              ... on MediaImage {
                id
                image {
                  url
                }
              }
              ... on Video {
                id
                sources {
                  url
                }
              }
              ... on GenericFile {
                id
                url
              }
            }
            references(first: 250) {
              edges {
                node {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on ProductVariant {
                    id
                    sku
                    product {
                      handle
                    }
                  }
                  ... on Collection {
                    id
                    handle
                  }
                  ... on Page {
                    id
                    handle
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const METAOBJECT_UPSERT = `
  mutation metaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Products with Metafields
 */
export const PRODUCTS_BULK = `
  {
    products {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          status
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                }
                references(first: 250) {
                  edges {
                    node {
                      __typename
                      ... on Metaobject {
                        id
                        type
                        handle
                      }
                      ... on Product {
                        id
                        handle
                      }
                    }
                  }
                }
              }
            }
          }
          variants(first: 250) {
            edges {
              node {
                id
                sku
                title
                position
                metafields(first: 250) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Collections with Metafields
 */
export const COLLECTIONS_BULK = `
  {
    collections {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Metafields Set (Batch Upsert)
 */
export const METAFIELDS_SET = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
        ownerType
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Files
 */
export const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        createdAt
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const FILES_BULK = `
  {
    files {
      edges {
        node {
          ... on MediaImage {
            id
            alt
            createdAt
            fileStatus
            image {
              url
            }
          }
          ... on Video {
            id
            alt
            createdAt
            fileStatus
            sources {
              url
            }
          }
          ... on GenericFile {
            id
            alt
            createdAt
            fileStatus
            url
            mimeType
          }
        }
      }
    }
  }
`;

/**
 * Pages
 */
export const PAGES_BULK = `
  {
    pages {
      edges {
        node {
          id
          handle
          title
          body
          bodySummary
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Shop (for shop-level metafields)
 */
export const SHOP_BULK = `
  {
    shop {
      id
      name
      metafields(first: 250) {
        edges {
          node {
            id
            namespace
            key
            value
            type
            reference {
              __typename
              ... on Metaobject {
                id
                type
                handle
              }
              ... on Product {
                id
                handle
              }
              ... on Collection {
                id
                handle
              }
              ... on Page {
                id
                handle
              }
            }
            references(first: 250) {
              edges {
                node {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                  ... on Page {
                    id
                    handle
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const PAGE_CREATE = `
  mutation pageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const PAGE_UPDATE = `
  mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Menus
 */
export const MENUS_QUERY = `
  query menus($first: Int!) {
    menus(first: $first) {
      edges {
        node {
          id
          handle
          title
          items {
            id
            title
            url
            type
            items {
              id
              title
              url
              type
              items {
                id
                title
                url
                type
              }
            }
          }
        }
      }
    }
  }
`;

export const MENU_CREATE = `
  mutation menuCreate($menu: MenuCreateInput!) {
    menuCreate(menu: $menu) {
      menu {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $menu: MenuInput!) {
    menuUpdate(id: $id, menu: $menu) {
      menu {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MENU_DELETE = `
  mutation menuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Redirects
 */
export const REDIRECTS_BULK = `
  {
    urlRedirects {
      edges {
        node {
          id
          path
          target
        }
      }
    }
  }
`;

export const REDIRECT_CREATE = `
  mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Product/Collection/Page lookups for mapping
 */
export const PRODUCTS_HANDLES_QUERY = `
  query products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCTS_WITH_VARIANTS_QUERY = `
  query productsWithVariants($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          variants(first: 100) {
            edges {
              node {
                id
                sku
                position
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const COLLECTIONS_HANDLES_QUERY = `
  query collections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PAGES_HANDLES_QUERY = `
  query pages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAOBJECTS_HANDLES_QUERY = `
  query metaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      edges {
        node {
          id
          type
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
