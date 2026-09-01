# Domain modules

每个业务域在独立子目录内拥有授权、状态机、事务编排和端口接口。领域入口不得依赖页面或 H3 Handler，也不得把数据库行直接作为公网 DTO。

计划中的首期域为 identity、teams、contests、challenges、submissions、scoreboards、instances、content、notifications 与 administration。
