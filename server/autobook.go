package main

import (
	"autobook/config"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/nu7hatch/gouuid"
	"io/ioutil"
	"strings"
)

const (
	serverPort = "8081"
)

func main() {
	initOSSClient()
	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowMethods:     []string{"GET", "POST", "OPTIONS", "PUT"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type", "User-Agent", "Referrer", "Host", "Token", "account", "token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		AllowAllOrigins:  false,
		AllowOriginFunc:  func(origin string) bool { return true },
		MaxAge:           86400,
	}))
	r.GET("/", index)
	r.POST("/verifyKey", verifyKey)
	r.POST("/updateData", updateData)
	r.POST("/updateDataGraph", updateDataGraph)
	r.Run(":" + serverPort)
}

var PrivateLibBucket *oss.Bucket
var PublicLibBucket *oss.Bucket

var verifiedKeyMap = map[string]string{}

// 初始化oss客户端
func initOSSClient() {
	// 连接oss
	client, e := oss.New(config.EndpointSZ, config.Aki, config.Aks)
	if e != nil {
		println("oss连接失败")
		panic(e)
	}
	// 连接bucket
	privateLibBucket, e := client.Bucket(config.PrivateLib)
	if e != nil {
		println("连接私有库失败")
		panic(e)
	}
	PrivateLibBucket = privateLibBucket

	client1, e := oss.New(config.EndpointBJ, config.Aki, config.Aks)
	if e != nil {
		println("oss连接失败")
		panic(e)
	}
	// 连接bucket
	publicLibBucket, e := client1.Bucket(config.PublicLib)
	if e != nil {
		println("连接开放库失败")
		panic(e)
	}
	PublicLibBucket = publicLibBucket
}

// 首页
func index(c *gin.Context) {
	c.Writer.Write([]byte("欢迎访问首页"))
}

// 验证口令(账号和密码)
func verifyKey(c *gin.Context) {
	//  验证身份
	account := c.PostForm("account")
	password := c.PostForm("password")

	if len(account) < 1 || len(password) < 1 {
		c.JSON(500, gin.H{
			"message": "口令不能为空",
		})
		return
	}
	body, i2 := PrivateLibBucket.GetObject("userAccount2Password/" + account)
	if i2 != nil {
		c.JSON(500, gin.H{
			"message": "读取文件异常",
		})
		return
	}
	bytes, i3 := ioutil.ReadAll(body)
	body.Close()
	if i3 != nil {
		c.JSON(500, gin.H{
			"message": "读取文件内容异常",
		})
		return
	}
	if string(bytes) != password {
		c.JSON(500, gin.H{
			"message": "口令错误",
		})
		return
	}
	token := genUUID()
	println(token)
	verifiedKeyMap[account] = token
	c.JSON(200, gin.H{
		"message": "登陆成功",
		"token":   token,
		"account": account,
	})
}
func genUUID() string {
	u, _ := uuid.NewV4()
	uuidStr := u.String()
	uuidStr = strings.Replace(uuidStr, "-", "", -1)
	return uuidStr
}

// 验证账号已经登录的令牌是否有效
func verifyTokenFailure(c *gin.Context) (bool, string) {
	account := c.GetHeader("account")
	token := c.GetHeader("token")
	if account == "" || token == "" {
		c.JSON(500, gin.H{
			"message": "保存内容失败,令牌校验不通过",
		})
		return true, ""
	}
	oldToken := verifiedKeyMap[account]
	if token == oldToken {
		return false, account
	}
	c.JSON(500, gin.H{
		"message": "令牌校验失败",
	})
	return true, ""
}

// 修改数据图

func updateDataGraph(c *gin.Context) {
	isVerifyTokenFailure, account := verifyTokenFailure(c)
	if isVerifyTokenFailure {
		return
	}
	content := c.PostForm("content")
	println(account, content)
	e := PublicLibBucket.PutObject(account, strings.NewReader(content))
	if e != nil {
		c.JSON(500, gin.H{
			"message": "保存上一次数据图异常",
		})
		return
	}
	c.JSON(200, gin.H{
		"message": "保存数据图成功",
	})
}

// 修改数据
func updateData(c *gin.Context) {
	isVerifyTokenFailure, _ := verifyTokenFailure(c)
	if isVerifyTokenFailure {
		return
	}
	id := c.PostForm("id")
	content := c.PostForm("content")
	if id == "" {
		id = "data_" + genUUID()
	}
	err1 := PublicLibBucket.PutObject(id, strings.NewReader(content))
	if err1 != nil {
		c.JSON(500, gin.H{
			"message": "保存内容失败,保存内容异常",
		})
		return
	}
	c.JSON(200, gin.H{
		"message": "保存内容成功",
		id:        id,
	})
}
